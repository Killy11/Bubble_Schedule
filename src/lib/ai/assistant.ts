import type { AssistantAction, AssistantTask } from "@/types/api";
import { dateKeyInTz, localNaiveToUtc, toLocalNaive } from "@/lib/time";

export const MAX_TITLE = 100;
const MAX_TASKS = 10;

export const ASSISTANT_SYSTEM_PROMPT = `You are the AI assistant inside BubbleSchedule, an app that shows tasks as bubbles.
Read the user's message and decide what they want:
- "create_tasks": they describe one or more things to do (e.g. "remind me to send the report tomorrow at 5pm"). Extract each as a task.
- "schedule": they want the day re-planned or adjusted (e.g. "I overslept, shift my morning tasks", "prioritize study today", "plan my day"). Do not extract tasks.
- "modify_tasks": they want to change tasks that already exist (move/reschedule a task, change its deadline or duration, mark it done, delete it, remove its deadline). Put each change in "actions", matching the task by id from existingTasks. Do not create new tasks for these.
- "answer": a question or chat that needs neither. Answer briefly using the context given.

Task fields:
- title: short, imperative, at most 100 characters, same language as the user.
- deadline: LOCAL wall-clock time "YYYY-MM-DDTHH:mm" in the user's timezone. Resolve relative words ("tomorrow", "Friday", "in 2 hours") from NOW. If the user gives a date without a time use 18:00. Vague ranges map to the END of that period at 18:00: "this week" → this Friday, "next week" → next Friday, "this weekend" → Sunday, "this month" → the last day of the month. If they give no date or time at all (or only "soon"/"sometime"), return null: the task simply has no deadline. Never invent a deadline.
- durationMin: whole minutes if stated or clearly implied ("a 2 hour workshop"), otherwise null.
Never invent tasks the user did not ask for. At most ${MAX_TASKS} tasks.
Actions: type "update" (set "deadline" as LOCAL "YYYY-MM-DDTHH:mm", and/or "durationMin", and/or "title"; set "removeDeadline" true to clear the deadline), "complete" (mark finished) or "delete". Use null for fields you don't change. Reply in the user's language.
"reply" is a friendly 1–3 sentence message: say what you added or what you will do, and mention any assumption.`;

/** JSON Schema the model's reply is constrained to (Gemini responseJsonSchema). */
export const ASSISTANT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "reply", "tasks", "actions"],
  properties: {
    intent: { type: "string", enum: ["create_tasks", "modify_tasks", "schedule", "answer"] },
    reply: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "taskId", "title", "deadline", "removeDeadline", "durationMin"],
        properties: {
          type: { type: "string", enum: ["update", "complete", "delete"] },
          taskId: { type: "string" },
          title: { type: ["string", "null"] },
          deadline: { type: ["string", "null"] },
          removeDeadline: { type: "boolean" },
          durationMin: { type: ["integer", "null"] },
        },
      },
    },
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "deadline", "durationMin"],
        properties: {
          title: { type: "string" },
          deadline: { type: ["string", "null"] },
          durationMin: { type: ["integer", "null"] },
        },
      },
    },
  },
} as const;

export interface RawAssistantTask {
  title: string;
  deadline: string | null; // local naive
  durationMin: number | null;
}
export interface RawAssistantAction {
  type: "update" | "complete" | "delete";
  taskId: string;
  title: string | null;
  deadline: string | null; // local naive
  removeDeadline: boolean;
  durationMin: number | null;
}
export interface RawAssistantResult {
  intent: "create_tasks" | "modify_tasks" | "schedule" | "answer";
  reply: string;
  tasks: RawAssistantTask[];
  actions?: RawAssistantAction[];
}

/** Validate the model's actions: known task ids only, sane values, no empty updates. */
export function normalizeActions(raw: RawAssistantAction[], validIds: ReadonlySet<string>, tz: string): AssistantAction[] {
  const out: AssistantAction[] = [];
  for (const a of raw.slice(0, MAX_TASKS)) {
    if (!validIds.has(a.taskId)) continue;
    if (a.type === "complete" || a.type === "delete") {
      out.push({ type: a.type, taskId: a.taskId });
      continue;
    }
    if (a.type !== "update") continue;
    const parsed = a.deadline ? localNaiveToUtc(a.deadline, tz) : null;
    const deadline = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : undefined;
    const title = a.title ? String(a.title).replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) : undefined;
    const durationMin =
      Number.isFinite(a.durationMin) && a.durationMin! > 0 ? Math.max(5, Math.min(480, Math.round(a.durationMin!))) : undefined;
    const removeDeadline = a.removeDeadline === true && !deadline;
    if (!deadline && !title && !durationMin && !removeDeadline) continue;
    out.push({ type: "update", taskId: a.taskId, title, deadline, durationMin, removeDeadline: removeDeadline || undefined });
  }
  return out;
}

/** Turn the model's raw tasks into validated, schema-shaped tasks. Never trusts the model's output. */
export function normalizeTasks(raw: RawAssistantTask[], tz: string): AssistantTask[] {
  const out: AssistantTask[] = [];
  for (const t of raw.slice(0, MAX_TASKS)) {
    const title = String(t.title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
    if (!title) continue;
    const parsed = t.deadline ? localNaiveToUtc(t.deadline, tz) : null;
    const deadline = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    out.push({
      title,
      deadline: deadline?.toISOString(), // none stated → no deadline (never invented)
      durationMin:
        Number.isFinite(t.durationMin) && t.durationMin! > 0
          ? Math.max(5, Math.min(480, Math.round(t.durationMin!)))
          : undefined,
    });
  }
  return out;
}

/**
 * Canned response used when GEMINI_API_KEY is missing, so the whole chat → task flow can be tried
 * without a key. Simple keyword heuristics, clearly labelled as demo mode.
 */
export function mockAssistant(message: string, now: Date, tz: string): RawAssistantResult {
  const m = message.trim();
  const demo = " (Demo mode: add GEMINI_API_KEY to .env.local for real AI.)";

  if (/\b(schedule|re-?plan|shift|overslept|resched|prioriti[sz]e|plan my day|move my)\b/i.test(m)) {
    return { intent: "schedule", reply: "Sure, I'll re-plan your day." + demo, tasks: [], actions: [] };
  }
  if (m.endsWith("?")) {
    return { intent: "answer", reply: "I can add tasks from plain text, like “send the report tomorrow 5pm”, or re-plan your day." + demo, tasks: [], actions: [] };
  }

  const dur = /(\d+)\s*(?:h|hr|hrs|hour|hours)\b/i.exec(m);
  const mins = /(\d+)\s*(?:m|min|mins|minutes)\b/i.exec(m);
  const durationMin = dur ? Number(dur[1]) * 60 : mins ? Number(mins[1]) : null;

  let deadline: string | null = null;
  if (/\btomorrow\b/i.test(m)) {
    const d = dateKeyInTz(new Date(now.getTime() + 24 * 3_600_000), tz);
    const t = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(m);
    let hh = 18, mm = 0;
    if (t) { hh = Number(t[1]) % 12 + (t[3].toLowerCase() === "pm" ? 12 : 0); mm = Number(t[2] ?? 0); }
    deadline = `${d}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }
  const title = m.replace(/^(remind me to|i need to|i have to|please|add|todo:?)\s+/i, "").slice(0, MAX_TITLE);
  return {
    intent: "create_tasks",
    actions: [],
    reply: `Added “${title}”.` + demo,
    tasks: [{ title, deadline, durationMin }],
  };
}

export function localNow(now: Date, tz: string) {
  return toLocalNaive(now, tz);
}
