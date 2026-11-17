import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionUid } from "@/lib/firebase/serverAuth";
import { fromFirestoreData, toFirestoreData } from "@/lib/firebase/converters";
import { describeAiError, generateJson, hasGeminiKey } from "@/lib/ai/gemini";
import { sanitizeSettings } from "@/lib/ai/horizon";
import { DEFAULT_SETTINGS } from "@/lib/firebase/users";
import { effectiveDuration } from "@/lib/bubbles/effective";
import { fallbackParts, normalizeParts, partCount, type Part } from "@/lib/decompose";
import { pacingOf } from "@/lib/pacing";
import { MAX_SUBTASKS, newSubtaskId } from "@/lib/subtasks";
import { rebalanceAll } from "@/lib/server/rebalance";
import { toLocalNaive } from "@/lib/time";
import type { Subtask, Task, User } from "@/types";

export const maxDuration = 60;

const systemPrompt = (count: number, exact: boolean) => `You break a large task into concrete, sequential working sessions for a time-planning app.
- Return ${exact ? `EXACTLY ${count}` : `about ${count} (between 2 and ${MAX_SUBTASKS})`} parts, in the order they should be done. ${
  exact ? "The user asked for this many parts. " : "Each part is one focused session of 45–75 minutes (about an hour). "
}
- Each part is a specific action with a clear outcome (e.g. "Outline the report and collect sources"), not a vague phase like "Work on it" and not just "Part 2".
- Titles are short (at most 80 characters), imperative, and in the same language as the task title.
- The durations must add up to roughly "totalMinutes".
- Do not schedule anything or mention dates: only split the work.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["parts"],
  properties: {
    parts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "durationMin"],
        properties: { title: { type: "string" }, durationMin: { type: "integer" } },
      },
    },
  },
} as const;

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  const uid = await getSessionUid();
  if (!uid) return err("Not signed in", 401);

  let body: { taskId?: string; nowISO?: string; force?: boolean; parts?: number };
  try {
    body = await request.json();
  } catch {
    return err("Invalid request body", 400);
  }
  const taskId = String(body.taskId ?? "");
  if (!taskId || !body.nowISO || Number.isNaN(Date.parse(body.nowISO))) return err("taskId or nowISO is invalid", 400);
  const now = new Date(body.nowISO);
  if (Math.abs(now.getTime() - Date.now()) > 10 * 60_000) return err("Your device clock looks wrong", 400);
  const force = body.force === true;
  const asked = Number.isInteger(body.parts) && body.parts! >= 2 && body.parts! <= MAX_SUBTASKS ? body.parts : undefined;

  const db = adminDb();
  const taskRef = db.doc(`users/${uid}/tasks/${taskId}`);

  // Claim the attempt, so two tabs (or a retry) can't split the same task twice.
  const claimed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(taskRef);
    if (!snap.exists) return "missing" as const;
    const t = fromFirestoreData<Task>(snap.data());
    if (t.status !== "active") return "inactive" as const;
    if (!force && (t.subtasksAttempted || t.subtasks?.length)) return "skipped" as const;
    tx.update(taskRef, { subtasksAttempted: true });
    return "ok" as const;
  });
  if (claimed === "missing") return err("That task no longer exists", 404);
  if (claimed === "inactive") return err("Only active tasks can be split", 400);
  if (claimed === "skipped") return NextResponse.json({ skipped: true });

  const [userSnap, taskSnap] = await Promise.all([db.doc(`users/${uid}`).get(), taskRef.get()]);
  const user = userSnap.exists ? fromFirestoreData<User>(userSnap.data()) : null;
  const tz = user?.timezone ?? "UTC";
  const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...user?.settings });
  const task = { ...fromFirestoreData<Task>(taskSnap.data()), id: taskId };

  if (Date.parse(task.deadline) <= now.getTime() + 30 * 60_000) return err("This task is due too soon to split.", 400);
  // Locked-in tasks are only split when the user says how many parts (a number from the request, or on the task).
  const requested = asked ?? task.requestedParts;
  if (pacingOf(task) === "locked" && !requested && !force) return NextResponse.json({ skipped: true });

  // Work already done (completed parts) stays; only the remaining work is split.
  const keep: Subtask[] = force ? (task.subtasks ?? []).filter((s) => s.completed) : [];
  const keptMin = keep.reduce((s, x) => s + x.durationMinutes, 0);
  const total = Math.max(
    30,
    (effectiveDuration(task) ?? settings.defaultTaskMinutes * 4) - (force ? keptMin : task.loggedMinutes ?? 0),
  );
  const count = partCount(total, requested, MAX_SUBTASKS);

  // Split the work (AI, or an even split when AI is unavailable).
  let parts: Part[] = [];
  let usedAI = false;
  if (hasGeminiKey()) {
    try {
      const raw = await generateJson<{ parts: Array<{ title: string; durationMin: number }> }>({
        system: systemPrompt(count, !!requested),
        turns: [
          {
            role: "user",
            text: JSON.stringify({
              title: task.title,
              description: task.description ?? null,
              totalMinutes: total,
              deadline: toLocalNaive(task.deadline, tz),
              now: toLocalNaive(now, tz),
            }),
          },
        ],
        schema: SCHEMA,
        temperature: 0.3,
        effort: "low",
      });
      parts = normalizeParts(raw.parts ?? [], total, MAX_SUBTASKS, requested);
      usedAI = parts.length > 0;
    } catch (e) {
      console.error("decompose: model call failed", e);
      if (force) {
        const { message, status } = describeAiError(e);
        return err(message, status); // the user asked for AI explicitly: say it failed
      }
    }
  }
  if (parts.length === 0) parts = fallbackParts(task.title, total, count);

  const created: Subtask[] = parts.map((p) => ({
    id: newSubtaskId(),
    title: p.title,
    durationMinutes: p.durationMin,
    completed: false,
  }));
  const subtasks = [...keep, ...created];
  await taskRef.update(
    toFirestoreData({ subtasks, subtasksAttempted: true, updatedAt: new Date().toISOString() }) as Record<string, unknown>,
  );

  // Give every part its time slot as part of one plan for all tasks (pacing, breaks, deadlines, other tasks).
  try {
    await rebalanceAll(uid, now);
  } catch (e) {
    console.error("decompose: re-plan failed", e);
  }
  const fresh = fromFirestoreData<Task>((await taskRef.get()).data());
  const final = fresh.subtasks ?? subtasks;
  const newIds = new Set(created.map((c) => c.id));
  return NextResponse.json({
    subtasks: final,
    usedAI,
    placed: final.filter((s) => newIds.has(s.id) && s.scheduledStart).length,
    total: created.length,
  });
}
