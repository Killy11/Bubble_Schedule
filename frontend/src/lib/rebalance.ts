import type { Pacing, Subtask, Task, UserSettings } from "@/types";
import { effectiveDuration } from "@/lib/bubbles/effective";
import { comparePriority, toMillis, urgencyTier } from "@/lib/priority";
import { pacingOf } from "@/lib/pacing";
import { needsDecomposition } from "@/lib/subtasks";
import { planUnits, DAY_CAP_MIN, type PlanUnit } from "@/lib/planner";
import type { Interval } from "@/lib/decompose";

/** Urgency tier first (red, yellow, green, none), then earliest deadline, then oldest. */
export function planningOrder(tasks: readonly Task[], nowMs: number): Task[] {
  return [...tasks].sort((a, b) => comparePriority(a, b, nowMs)); // red, yellow, green, no deadline; then earliest due
}

/** Tasks without a deadline are spread over a rolling 3-month window (soft: nothing ever turns overdue). */
export const NO_DEADLINE_PLAN_DAYS = 90;

export interface PlanResult {
  /** taskId → (subtaskId → new slot, or null when it doesn't fit before the deadline) */
  partSlots: Map<string, Map<string, Interval | null>>;
  /** One block for each task that has no parts. */
  blocks: Array<{ taskId: string; start: number; end: number; /** a fixed-time task: shown pinned */ fixed?: boolean }>;
  /** Tasks (or parts of them) that can't fit before their deadline. */
  unplaced: Task[];
  /** Tasks still waiting for the AI to split them into parts. */
  awaitingSplit: string[];
}

const hasSpan = (s: Subtask) => !!(s.scheduledStart && s.scheduledEnd);

/**
 * Re-plan every active task from scratch. Locked-in tasks claim their time first (one unbroken
 * block, never split); Balanced and Chill tasks are laid out around them, earliest deadline first,
 * so they are pushed later in the day or to later days when a locked task needs the room.
 * Hand-pinned times never move. Pure and deterministic.
 */
export function planAll(o: {
  tasks: readonly Task[];
  nowMs: number;
  tz: string;
  settings: UserSettings;
  /** Immovable intervals: pinned blocks the user set by hand. */
  fixed: Interval[];
  /** Tasks that already own a fixed (pinned) block and need no other one. */
  hasFixedBlock: ReadonlySet<string>;
}): PlanResult {
  const result: PlanResult = { partSlots: new Map(), blocks: [], unplaced: [], awaitingSplit: [] };
  const fixed: Interval[] = [...o.fixed];
  const units: PlanUnit[] = [];
  const order = planningOrder(o.tasks, o.nowMs);

  for (const t of order) {
    for (const s of t.subtasks ?? []) {
      if (!s.completed && s.pinned && hasSpan(s) && Date.parse(s.scheduledEnd!) > o.nowMs) {
        fixed.push({ start: Date.parse(s.scheduledStart!), end: Date.parse(s.scheduledEnd!) });
      }
    }
  }

  // Fixed-time tasks keep exactly their requested window: it is an immovable interval for everyone else.
  const isFixed = (t: Task) => !!t.isFixedTime && !!t.fixedStartTime && !Number.isNaN(Date.parse(t.fixedStartTime));
  const fixedWindow = (t: Task) => {
    const start = Date.parse(t.fixedStartTime!);
    return { start, end: start + Math.max(5, effectiveDuration(t) ?? o.settings.defaultTaskMinutes) * 60_000 };
  };
  for (const t of order) {
    if (!isFixed(t)) continue;
    const w = fixedWindow(t);
    if (w.end <= o.nowMs) continue; // already over
    fixed.push(w);
    result.blocks.push({ taskId: t.id, ...w, fixed: true });
  }

  order.forEach((t, orderIdx) => {
    if (isFixed(t)) return; // placed above, never re-planned
    const dueMs = t.deadline ? Date.parse(t.deadline) : o.nowMs + NO_DEADLINE_PLAN_DAYS * 86_400_000;
    if (dueMs <= o.nowMs + 30 * 60_000) return; // about to expire: nothing useful to plan
    const pacing: Pacing = pacingOf(t);
    const base = { taskId: t.id, deadlineMs: dueMs, pacing, orderIdx, tier: urgencyTier(toMillis(t.deadline), o.nowMs) };

    if (t.subtasks?.length) {
      const parts = t.subtasks
        .filter((s) => !s.completed && !(s.pinned && hasSpan(s)))
        .map((s, i) => ({ s, i }))
        .sort((a, b) => (a.s.scheduledStart ?? "9").localeCompare(b.s.scheduledStart ?? "9") || a.i - b.i)
        .map((x) => x.s);
      parts.forEach((s, i) =>
        units.push({ ...base, key: `${t.id}:${s.id}`, subId: s.id, durationMin: s.durationMinutes, seq: i, count: parts.length }),
      );
      return;
    }
    if (o.hasFixedBlock.has(t.id)) return;
    if (needsDecomposition(t)) {
      result.awaitingSplit.push(t.id);
      return;
    }
    const total = effectiveDuration(t) ?? o.settings.defaultTaskMinutes;
    const remaining = Math.max(15, total - (t.loggedMinutes ?? 0));
    // A monolithic locked-in block keeps its full length; others are capped at one day's load.
    const durationMin = pacing === "locked" ? remaining : Math.min(DAY_CAP_MIN.balanced, remaining);
    units.push({ ...base, key: t.id, durationMin, seq: 0, count: 1 });
  });

  const partial = new Set<string>();
  const placed = planUnits({ units, nowMs: o.nowMs, tz: o.tz, settings: o.settings, fixed, partial });

  const taskById = new Map(o.tasks.map((t) => [t.id, t]));
  const failed = new Set<string>();
  for (const u of units) {
    const slot = placed.get(u.key) ?? null;
    if (!slot || partial.has(u.key)) failed.add(u.taskId); // partial = only part of its time fit before the deadline
    if (u.subId) {
      const m = result.partSlots.get(u.taskId) ?? new Map<string, Interval | null>();
      m.set(u.subId, slot);
      result.partSlots.set(u.taskId, m);
    } else if (slot) {
      result.blocks.push({ taskId: u.taskId, ...slot });
    }
  }
  for (const id of failed) {
    const t = taskById.get(id);
    if (t) result.unplaced.push(t);
  }
  return result;
}
