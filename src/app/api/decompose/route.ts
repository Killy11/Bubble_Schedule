import { NextResponse } from "next/server";
import { FieldPath } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionUid } from "@/lib/firebase/serverAuth";
import { fromFirestoreData, toFirestoreData } from "@/lib/firebase/converters";
import { describeAiError, generateJson, hasGeminiKey } from "@/lib/ai/gemini";
import { sanitizeSettings } from "@/lib/ai/horizon";
import { DEFAULT_SETTINGS } from "@/lib/firebase/users";
import { effectiveDuration } from "@/lib/bubbles/effective";
import { fallbackParts, normalizeParts, placeParts, type Interval, type Part } from "@/lib/decompose";
import { MAX_SUBTASKS, newSubtaskId } from "@/lib/subtasks";
import { dateKeyInTz, toLocalNaive } from "@/lib/time";
import type { Schedule, Subtask, Task, User } from "@/types";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You break a large task into concrete, sequential working sessions for a time-planning app.
- Return between 2 and ${MAX_SUBTASKS} parts, in the order they should be done. Each part is one focused session of 30–90 minutes (never more than 120).
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

  let body: { taskId?: string; nowISO?: string; force?: boolean };
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

  const todayKey = dateKeyInTz(now, "UTC"); // lower bound only; the exact local day is refined below
  const [userSnap, taskSnap, activeSnap, schedSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    taskRef.get(),
    db.collection(`users/${uid}/tasks`).where("status", "==", "active").limit(100).get(),
    db.collection(`users/${uid}/schedules`).where(FieldPath.documentId(), ">=", addDaysKey(todayKey, -1)).limit(40).get(),
  ]);
  const user = userSnap.exists ? fromFirestoreData<User>(userSnap.data()) : null;
  const tz = user?.timezone ?? "UTC";
  const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...user?.settings });
  const task = { ...fromFirestoreData<Task>(taskSnap.data()), id: taskId };

  const deadlineMs = Date.parse(task.deadline);
  if (deadlineMs <= now.getTime() + 30 * 60_000) return err("This task is due too soon to split.", 400);

  // Work already done (completed parts) stays; only the remaining work is split.
  const keep: Subtask[] = force ? (task.subtasks ?? []).filter((s) => s.completed) : [];
  const keptMin = keep.reduce((s, x) => s + x.durationMinutes, 0);
  const total = Math.max(
    30,
    (effectiveDuration(task) ?? settings.defaultTaskMinutes * 4) - (force ? keptMin : task.loggedMinutes ?? 0),
  );

  // Time already taken by other tasks' parts and by blocks on the day plan.
  const busy: Interval[] = [];
  for (const d of activeSnap.docs) {
    if (d.id === taskId) continue;
    const t = fromFirestoreData<Task>(d.data());
    for (const s of t.subtasks ?? []) {
      if (!s.completed && s.scheduledStart && s.scheduledEnd) {
        busy.push({ start: Date.parse(s.scheduledStart), end: Date.parse(s.scheduledEnd) });
      }
    }
  }
  for (const d of schedSnap.docs) {
    const sch = fromFirestoreData<Schedule>(d.data());
    for (const b of sch.blocks ?? []) {
      if (b.status !== "done" && b.taskId !== taskId) busy.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
    }
  }

  // 1) Split the work (AI, or an even split when AI is unavailable).
  let parts: Part[] = [];
  let usedAI = false;
  if (hasGeminiKey()) {
    try {
      const raw = await generateJson<{ parts: Array<{ title: string; durationMin: number }> }>({
        system: SYSTEM_PROMPT,
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
      parts = normalizeParts(raw.parts ?? [], total, MAX_SUBTASKS);
      usedAI = parts.length > 0;
    } catch (e) {
      console.error("decompose: model call failed", e);
      if (force) {
        const { message, status } = describeAiError(e);
        return err(message, status); // the user asked for AI explicitly: say it failed
      }
    }
  }
  if (parts.length === 0) parts = fallbackParts(task.title, total, MAX_SUBTASKS);

  // 2) Give every part a real time slot (working hours, before the deadline, clear of other work).
  const slots = placeParts({ parts, nowMs: now.getTime(), deadlineMs, tz, settings, busy });
  const created: Subtask[] = parts.map((p, i) => ({
    id: newSubtaskId(),
    title: p.title,
    durationMinutes: p.durationMin,
    ...(slots[i]
      ? { scheduledStart: new Date(slots[i]!.start).toISOString(), scheduledEnd: new Date(slots[i]!.end).toISOString() }
      : {}),
    completed: false,
  }));
  const subtasks = [...keep, ...created];

  await taskRef.update(
    toFirestoreData({ subtasks, subtasksAttempted: true, updatedAt: new Date().toISOString() }) as Record<string, unknown>,
  );
  return NextResponse.json({
    subtasks,
    usedAI,
    placed: slots.filter(Boolean).length,
    total: created.length,
  });
}

function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
