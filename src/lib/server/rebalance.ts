import "server-only";
import { FieldPath } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase/admin";
import { fromFirestoreData, toFirestoreData } from "@/lib/firebase/converters";
import { sanitizeSettings } from "@/lib/ai/horizon";
import { DEFAULT_SETTINGS } from "@/lib/firebase/users";
import { planAll } from "@/lib/rebalance";
import { addDays, dateKeyInTz } from "@/lib/time";
import type { Schedule, ScheduleBlock, Subtask, Task, User } from "@/types";

export interface RebalanceResult {
  unplaced: Array<{ id: string; title: string }>;
  awaitingSplit: number;
  blocks: number;
}

/**
 * Re-plan ALL active tasks (and their parts) and save the result: new times for parts on the
 * tasks, and one block per part-less task in today's schedule. Locked-in tasks first, then the
 * rest by earliest deadline, with each pacing's breaks and daily load.
 * Deterministic: no AI call.
 */
export async function rebalanceAll(uid: string, now: Date): Promise<RebalanceResult> {
  const db = adminDb();
  const nowMs = now.getTime();
  const userSnap = await db.doc(`users/${uid}`).get();
  const user = userSnap.exists ? fromFirestoreData<User>(userSnap.data()) : null;
  const tz = user?.timezone ?? "UTC";
  const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...user?.settings });
  const todayKey = dateKeyInTz(now, tz);

  const [taskSnap, schedSnap] = await Promise.all([
    db.collection(`users/${uid}/tasks`).where("status", "==", "active").limit(200).get(),
    db.collection(`users/${uid}/schedules`).where(FieldPath.documentId(), ">=", addDays(todayKey, -1)).limit(40).get(),
  ]);
  const tasks = taskSnap.docs.map((d) => {
    const t = fromFirestoreData<Task>(d.data());
    return { ...t, id: d.id, loggedMinutes: t.loggedMinutes ?? 0 };
  });
  const activeIds = new Set(tasks.map((t) => t.id));
  const docs = new Map(schedSnap.docs.map((d) => [d.id, fromFirestoreData<Schedule>(d.data())]));
  const today = docs.get(todayKey) ?? null;

  // Blocks the user pinned by hand are fixed; they keep their time and their task needs no other block.
  const pinnedBlocks: ScheduleBlock[] = [];
  for (const sch of docs.values()) {
    for (const b of sch.blocks ?? []) {
      if (b.isPinned && b.status === "planned" && activeIds.has(b.taskId) && Date.parse(b.end) > nowMs) pinnedBlocks.push(b);
    }
  }
  const plan = planAll({
    tasks, nowMs, tz, settings,
    fixed: pinnedBlocks.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })),
    hasFixedBlock: new Set(pinnedBlocks.map((b) => b.taskId)),
  });

  const nowIso = now.toISOString();
  const batch = db.batch();

  // 1) Parts: write the new slots on the tasks that changed.
  for (const t of tasks) {
    const slots = plan.partSlots.get(t.id);
    if (!slots || !t.subtasks) continue;
    let changed = false;
    const subtasks: Subtask[] = t.subtasks.map((s) => {
      if (!slots.has(s.id)) return s;
      const slot = slots.get(s.id);
      const start = slot ? new Date(slot.start).toISOString() : undefined;
      const end = slot ? new Date(slot.end).toISOString() : undefined;
      if (start === s.scheduledStart && end === s.scheduledEnd) return s;
      changed = true;
      const { scheduledStart: _a, scheduledEnd: _b, ...rest } = s;
      void _a; void _b;
      return { ...rest, ...(start && end ? { scheduledStart: start, scheduledEnd: end } : {}) };
    });
    if (changed) {
      batch.update(
        db.doc(`users/${uid}/tasks/${t.id}`),
        toFirestoreData({ subtasks, updatedAt: nowIso }) as Record<string, unknown>,
      );
    }
  }

  // 2) Today's schedule: finished blocks and pinned blocks stay, everything else is the new plan.
  const titleOf = new Map(tasks.map((t) => [t.id, t.title]));
  const done = (today?.blocks ?? []).filter((b) => b.status === "done");
  const alerted = new Map((today?.blocks ?? []).map((b) => [b.taskId, b.notified5mStart])); // keep "already alerted" across re-plans
  const fresh: ScheduleBlock[] = plan.blocks.map((b) => ({
    id: `blk_${b.taskId}`,
    taskId: b.taskId,
    title: titleOf.get(b.taskId) ?? "Task",
    start: new Date(b.start).toISOString(),
    end: new Date(b.end).toISOString(),
    reason: "Planned by earliest deadline",
    status: "planned",
    ...(alerted.get(b.taskId) ? { notified5mStart: alerted.get(b.taskId) } : {}),
  }));
  const blocks = [...done, ...pinnedBlocks, ...fresh].sort((a, b) => a.start.localeCompare(b.start));
  const schedule: Omit<Schedule, "dateKey"> = {
    blocks,
    version: (today?.version ?? 0) + 1,
    consideredTaskIds: tasks.map((t) => t.id),
    lastChange: {
      code: plan.unplaced.length ? "replanned_unplaced" : "replanned",
      count: plan.unplaced.length,
      summary: plan.unplaced.length
        ? `Re-planned by deadline. ${plan.unplaced.length} task${plan.unplaced.length > 1 ? "s" : ""} can't fully fit before ${plan.unplaced.length > 1 ? "their deadlines" : "its deadline"}.`
        : "Re-planned by earliest deadline.",
      changes: [],
      triggeredBy: "auto-schedule",
      at: nowIso,
    },
    generatedBy: today?.generatedBy ?? "ai",
    updatedAt: nowIso,
  };
  batch.set(db.doc(`users/${uid}/schedules/${todayKey}`), toFirestoreData(schedule) as Record<string, unknown>);

  // 3) Older plans may still hold future blocks for these tasks: drop them so nothing shows twice.
  for (const [key, sch] of docs) {
    if (key === todayKey) continue;
    const kept = (sch.blocks ?? []).filter((b) => b.status === "done" || b.isPinned || Date.parse(b.end) < nowMs);
    if (kept.length !== (sch.blocks ?? []).length) {
      batch.update(db.doc(`users/${uid}/schedules/${key}`), {
        blocks: toFirestoreData(kept),
        updatedAt: now,
      });
    }
  }

  await batch.commit();
  return {
    unplaced: plan.unplaced.map((t) => ({ id: t.id, title: t.title })),
    awaitingSplit: plan.awaitingSplit.length,
    blocks: fresh.length,
  };
}
