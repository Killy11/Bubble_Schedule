import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { fromFirestoreData, toFirestoreData } from "@/lib/firebase/converters";
import { verifyAction, type ActionPayload } from "@/lib/server/push";
import { addDays, dateKeyInTz } from "@/lib/time";
import type { Schedule, ScheduleBlock, Subtask, Task, User } from "@/types";

/**
 * Notification buttons. The service worker POSTs `{ token, action }`, where the token is the signed, expiring
 * one carried in the push (no cookie needed, the app doesn't have to be open).
 *  - done:   completes the task (or just that part; the last part completes the task)
 *  - snooze: moves that start 15 minutes later and nudges only the items it now overlaps, keeping their order.
 *            No AI and no full re-plan. The snoozed item is pinned so the next automatic re-plan keeps its new time.
 */
export const maxDuration = 30;
const SNOOZE_MS = 15 * 60_000;

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  let body: { token?: unknown; action?: unknown };
  try {
    body = await request.json();
  } catch {
    return err("Invalid request body", 400);
  }
  const p = typeof body.token === "string" ? verifyAction(body.token) : null;
  if (!p) return err("This action link has expired", 401);
  if (body.action !== "done" && body.action !== "snooze") return err("Unknown action", 400);

  try {
    if (body.action === "done") await markDone(p);
    else await snooze(p);
  } catch (e) {
    console.error("notification action failed", e);
    return err("Couldn't complete that action", 500);
  }
  return NextResponse.json({ ok: true });
}

async function markDone(p: ActionPayload) {
  const db = adminDb();
  const ref = db.doc(`users/${p.uid}/tasks/${p.taskId}`);
  const snap = await ref.get();
  if (!snap.exists) return;
  const task = { ...fromFirestoreData<Task>(snap.data()), id: snap.id };
  if (task.status !== "active") return;
  const now = new Date();

  if (p.kind === "part" && p.ref && task.subtasks?.some((s) => s.id === p.ref)) {
    const sub = task.subtasks.find((s) => s.id === p.ref)!;
    if (sub.completed) return;
    const subtasks = task.subtasks.map((s) => (s.id === p.ref ? { ...s, completed: true } : s));
    const allDone = subtasks.every((s) => s.completed);
    await ref.update({
      subtasks: toFirestoreData(subtasks),
      loggedMinutes: FieldValue.increment(sub.durationMinutes),
      updatedAt: now,
      ...(allDone ? { status: "completed", completedAt: now, startedAt: FieldValue.delete() } : {}),
    });
    return;
  }
  await ref.update({
    status: "completed",
    completedAt: now,
    updatedAt: now,
    startedAt: FieldValue.delete(),
    ...(task.subtasks?.length ? { subtasks: toFirestoreData(task.subtasks.map((s) => ({ ...s, completed: true }))) } : {}),
  });
}

interface Item {
  key: string;
  start: number;
  end: number;
  pinned: boolean;
  where: { type: "part"; taskId: string; subId: string } | { type: "block"; docId: string; blockId: string };
}

async function snooze(p: ActionPayload) {
  if (p.kind === "task" || !p.ref) return; // a deadline reminder has no start to move
  const db = adminDb();
  const now = Date.now();
  const user = (await db.doc(`users/${p.uid}`).get()).data() as User | undefined;
  const tz = user?.timezone ?? "UTC";

  const taskSnap = await db.collection(`users/${p.uid}/tasks`).where("status", "==", "active").limit(200).get();
  const tasks = new Map(taskSnap.docs.map((d) => [d.id, { ...fromFirestoreData<Task>(d.data()), id: d.id }]));
  const schedSnap = await db
    .collection(`users/${p.uid}/schedules`)
    .where(FieldPath.documentId(), ">=", addDays(dateKeyInTz(now, tz), -30))
    .limit(40)
    .get();
  const schedules = new Map(schedSnap.docs.map((d) => [d.id, fromFirestoreData<Schedule>(d.data())]));

  // One timeline of everything still ahead: parts of big tasks and standalone blocks.
  const items: Item[] = [];
  for (const t of tasks.values()) {
    for (const s of t.subtasks ?? []) {
      if (s.completed || !s.scheduledStart || !s.scheduledEnd) continue;
      items.push({ key: `p:${t.id}:${s.id}`, start: Date.parse(s.scheduledStart), end: Date.parse(s.scheduledEnd), pinned: !!s.pinned, where: { type: "part", taskId: t.id, subId: s.id } });
    }
  }
  for (const [docId, sch] of schedules) {
    for (const b of sch.blocks ?? []) {
      const t = tasks.get(b.taskId);
      if (!t || t.subtasks?.length || b.status !== "planned" || Date.parse(b.end) <= now) continue;
      items.push({ key: `b:${docId}:${b.id}`, start: Date.parse(b.start), end: Date.parse(b.end), pinned: !!b.isPinned, where: { type: "block", docId, blockId: b.id } });
    }
  }

  const target = items.find((i) => (i.where.type === "part" ? i.where.subId : i.where.blockId) === p.ref && (i.where.type === p.kind));
  if (!target) return;
  const origStart = target.start;
  const moved = new Map<string, { start: number; end: number }>();
  moved.set(target.key, { start: target.start + SNOOZE_MS, end: target.end + SNOOZE_MS });

  // Cascade: only what the shifted item now runs into moves, in the same order. Pinned items stay put.
  let prevEnd = target.end + SNOOZE_MS;
  const after = items.filter((i) => i.key !== target.key && i.start >= origStart).sort((a, b) => a.start - b.start);
  for (const it of after) {
    if (it.start >= prevEnd) break;
    if (it.pinned) {
      prevEnd = Math.max(prevEnd, it.end);
      continue;
    }
    const shift = prevEnd - it.start;
    moved.set(it.key, { start: it.start + shift, end: it.end + shift });
    prevEnd = it.end + shift;
  }

  // Write back, grouped per document. Moved items lose their alert marker; the snoozed one is pinned.
  const batch = db.batch();
  const partsByTask = new Map<string, Map<string, { start: number; end: number }>>();
  const blocksByDoc = new Map<string, Map<string, { start: number; end: number }>>();
  for (const it of items) {
    const m = moved.get(it.key);
    if (!m) continue;
    if (it.where.type === "part") {
      const g = partsByTask.get(it.where.taskId) ?? new Map();
      g.set(it.where.subId, m);
      partsByTask.set(it.where.taskId, g);
    } else {
      const g = blocksByDoc.get(it.where.docId) ?? new Map();
      g.set(it.where.blockId, m);
      blocksByDoc.set(it.where.docId, g);
    }
  }
  const nowIso = new Date(now).toISOString();
  for (const [taskId, g] of partsByTask) {
    const subtasks = (tasks.get(taskId)!.subtasks ?? []).map((s): Subtask => {
      const m = g.get(s.id);
      if (!m) return s;
      const { notified5mStart: _n, ...rest } = s;
      void _n;
      const isTarget = taskId === p.taskId && s.id === p.ref;
      return { ...rest, scheduledStart: new Date(m.start).toISOString(), scheduledEnd: new Date(m.end).toISOString(), ...(isTarget ? { pinned: true } : {}) };
    });
    batch.update(db.doc(`users/${p.uid}/tasks/${taskId}`), toFirestoreData({ subtasks, updatedAt: nowIso }) as Record<string, unknown>);
  }
  for (const [docId, g] of blocksByDoc) {
    const blocks = (schedules.get(docId)!.blocks ?? []).map((b): ScheduleBlock => {
      const m = g.get(b.id);
      if (!m) return b;
      const { notified5mStart: _n, ...rest } = b;
      void _n;
      const isTarget = b.id === p.ref;
      return { ...rest, start: new Date(m.start).toISOString(), end: new Date(m.end).toISOString(), ...(isTarget ? { isPinned: true } : {}) };
    });
    batch.update(db.doc(`users/${p.uid}/schedules/${docId}`), { blocks: toFirestoreData(blocks), updatedAt: new Date(now) });
  }
  await batch.commit();
}
