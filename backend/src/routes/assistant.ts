import { NextResponse } from "next/server";
import { adminDb } from "@backend/firebase/admin";
import { getSessionUid } from "@backend/firebase/serverAuth";
import { describeAiError, generateJson, hasGeminiKey } from "@backend/ai/gemini";
import { fromFirestoreData } from "@/lib/firebase/converters";
import {
  ASSISTANT_JSON_SCHEMA,
  ASSISTANT_SYSTEM_PROMPT,
  localNow,
  mockAssistant,
  normalizeActions,
  normalizeTasks,
  type RawAssistantResult,
} from "@backend/ai/assistant";
import { FileError, readFile, type ReadFile } from "@backend/server/files";
import { takeHourlySlot } from "@backend/server/rateLimit";
import { mergeMemory, sameMemory } from "@backend/server/memory";
import { addDays, weekdayOf, dateKeyInTz, toLocalNaive } from "@/lib/time";
import type { ChatMessage, Task, User } from "@/types";
import type { AssistantRequest, AssistantResponse } from "@/types/api";

const MAX_MESSAGE = 1000;
/** Sliding window: only the last 16 messages go to the model (plus the memory and the task list). */
const HISTORY_MESSAGES = 8;
const MAX_FILES = 3;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FILE_REQUESTS_PER_HOUR = 30;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  const uid = await getSessionUid();
  if (!uid) return err("Not signed in", 401);

  // JSON for plain messages; multipart/form-data when files are attached (message, nowISO, files[]).
  let body: AssistantRequest;
  const attached: ReadFile[] = [];
  try {
    if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const form = await request.formData();
      body = { message: String(form.get("message") ?? ""), nowISO: String(form.get("nowISO") ?? "") };
      const files = form.getAll("files").filter((f): f is File => f instanceof File);
      if (files.length > MAX_FILES) return err("Up to 3 files at a time.", 400);
      if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return err("The file is larger than 4 MB.", 413);
      if (files.length && !(await takeHourlySlot(uid, "chatfile", MAX_FILE_REQUESTS_PER_HOUR))) {
        return err("Too many file analyses. Please try again later.", 429);
      }
      for (const f of files) attached.push(await readFile(f.name, f.type, Buffer.from(await f.arrayBuffer())));
    } else {
      body = (await request.json()) as AssistantRequest;
    }
  } catch (e) {
    if (e instanceof FileError) return err(e.message, 422);
    return err("Invalid request body", 400);
  }
  const message = body.message?.trim().slice(0, MAX_MESSAGE);
  if (!message) return err("Say something first.", 400);
  if (Number.isNaN(Date.parse(body.nowISO))) return err("nowISO is invalid", 400);
  const now = new Date(body.nowISO);
  if (Math.abs(now.getTime() - Date.now()) > 10 * 60_000) return err("Your device clock looks wrong", 400);

  const db = adminDb();
  const [userSnap, taskSnap, msgSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.collection(`users/${uid}/tasks`).where("status", "==", "active").limit(60).get(),
    db.collection(`users/${uid}/messages`).orderBy("createdAt", "desc").limit(HISTORY_MESSAGES + 1).get(),
  ]);
  const userDoc = userSnap.exists ? fromFirestoreData<User>(userSnap.data()) : null;
  const tz = userDoc?.timezone ?? "UTC";
  const userMemory = Array.isArray(userDoc?.userMemory) ? userDoc.userMemory : [];

  const existing = taskSnap.docs
    .map((d) => ({ ...fromFirestoreData<Task>(d.data()), id: d.id }))
    .sort((a, b) => (a.deadline ?? "9").localeCompare(b.deadline ?? "9"));

  let raw: RawAssistantResult;
  let mock = false;

  if (!hasGeminiKey()) {
    // No key yet: keep the full flow usable with a heuristic stand-in.
    raw = mockAssistant(message, now, tz);
    mock = true;
  } else {
    const history = msgSnap.docs
      .map((d) => fromFirestoreData<ChatMessage>(d.data()))
      .reverse()
      .slice(0, -1) // the newest is the message being sent now
      .slice(-HISTORY_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 300) })); // short context = faster answers
    const today = dateKeyInTz(now, tz);
    const context = {
      NOW: localNow(now, tz),
      today: `${DAYS[weekdayOf(today)]} ${today}`,
      timezone: tz,
      // 14 days with weekdays: the model reads dates from here instead of calculating them.
      calendar: Array.from({ length: 14 }, (_, i) => {
        const key = addDays(today, i);
        return `${DAYS[weekdayOf(key)].slice(0, 3)} ${key}${i === 0 ? " (today)" : i === 1 ? " (tomorrow)" : ""}`;
      }),
      existingTasks: existing.slice(0, 40).map((t) => ({
        id: t.id,
        title: t.title,
        deadline: t.deadline ? toLocalNaive(t.deadline, tz) : null,
        durationMin: t.durationMin ?? null,
        // Only a real fixed slot counts as "scheduled at a time"; a deadline alone never does.
        // Steps of a split task: move one by its id; the others stay as they are.
        parts: (t.subtasks ?? []).filter((s) => !s.completed).map((s) => ({
          id: s.id, title: s.title, durationMin: s.durationMinutes, pinned: !!s.pinned,
          start: s.scheduledStart ? toLocalNaive(s.scheduledStart, tz) : null,
          end: s.scheduledEnd ? toLocalNaive(s.scheduledEnd, tz) : null,
        })),
        fixedStart: t.isFixedTime && t.fixedStartTime ? toLocalNaive(t.fixedStartTime, tz) : null,
      })),
      userMemory,
      recentChat: history,
      userMessage: message,
      // Files the user attached: PDFs / images ride along inline in this same request; documents arrive as text.
      attachments: attached.map((f) => ({ name: f.name, type: f.mimeType, how: f.kind === "inline" ? "attached inline (read it directly)" : "text extracted", text: f.text })),
    };
    try {
      raw = await generateJson<RawAssistantResult>({
        system: ASSISTANT_SYSTEM_PROMPT,
        turns: [{ role: "user", text: JSON.stringify(context), files: attached.filter((f) => f.kind === "inline").map((f) => ({ mimeType: f.mimeType, data: f.data! })) }],
        schema: ASSISTANT_JSON_SCHEMA,
        temperature: 0.2,
        effort: "none", // plain extraction: no reasoning needed, so it answers fast
      });
    } catch (e) {
      console.error("assistant: model call failed", e);
      const { message, status } = describeAiError(e);
      return err(message, status);
    }
  }

  // Long-term memory: keep a new permanent habit (no duplicates, max 12) and stamp the chat with today's date.
  try {
    const merged = mergeMemory(userMemory, Array.isArray(raw.memoryAdditions) ? raw.memoryAdditions : []);
    await db.doc(`users/${uid}`).update({
      chatDate: dateKeyInTz(now, tz),
      ...(sameMemory(userMemory, merged) ? {} : { userMemory: merged }),
    });
  } catch (e) {
    console.warn("assistant: memory update failed", e);
  }

  const tasks = raw.intent === "create_tasks" ? normalizeTasks(raw.tasks ?? [], tz) : [];
  // Real, validated changes win over the label: a "move X to 17–19" is executed even if the model called it "schedule".
  const titleById = new Map(existing.map((t) => [t.id, t.title]));
  const partIds = new Map(existing.map((t) => [t.id, new Set((t.subtasks ?? []).filter((s) => !s.completed).map((s) => s.id))]));
  const actions = normalizeActions(raw.actions ?? [], new Set(existing.map((t) => t.id)), tz, partIds).map((a) => ({
    ...a,
    taskTitle: titleById.get(a.taskId),
  }));
  if (actions.length > 0 && raw.intent !== "create_tasks") raw.intent = "modify_tasks";
  // The model claimed a change but nothing valid came back: never let the reply say it was done.
  const failedChange =
    (raw.intent === "create_tasks" && tasks.length === 0) ||
    (raw.intent === "modify_tasks" && actions.length === 0) ||
    // a "schedule" answer that names a specific time but changed nothing is a claim without a mutation
    (raw.intent === "schedule" && actions.length === 0 && !mock && /\b\d{1,2}[:.]\d{2}\b|\b(з|from|at|о)\s+\d{1,2}\b/i.test(message) && /(перен|постав|закр|move|put|pin|set)/i.test(message));
  const cyr = /[\u0400-\u04FF]/.test(message);
  const response: AssistantResponse = {
    intent: failedChange ? "answer" : raw.intent,
    reply: failedChange && !mock
      ? cyr
        ? "Не вдалося застосувати зміну: уточніть, будь ласка, яку задачу та на який час (наприклад, «Звіт з 17:00 до 19:00»)."
        : "I couldn't apply that change. Tell me which task and the exact time, for example “Report from 17:00 to 19:00”."
      : String(raw.reply ?? "").slice(0, 1200) || "Done.",
    tasks,
    actions,
    ...(mock ? { mock: true } : {}),
  };
  return NextResponse.json(response);
}
