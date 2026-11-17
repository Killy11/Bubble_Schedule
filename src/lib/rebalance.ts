import type { Priority, Subtask, Task, UserSettings } from "@/types";
import { effectiveDuration, effectivePriority } from "@/lib/bubbles/effective";
import { DAY_LOAD_CAP_MIN, placeParts, type Interval } from "@/lib/decompose";
import { needsDecomposition } from "@/lib/subtasks";

const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };

/** Earliest deadline first, then highest priority, then oldest. */
const rank = (t: Task): number => {
  const p = effectivePriority(t);
  return p ? PRIORITY_RANK[p] : 0;
};

export function planningOrder(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      Date.parse(a.deadline) - Date.parse(b.deadline) || rank(b) - rank(a) || a.createdAt.localeCompare(b.createdAt),
  );
}

export interface PlanResult {
  /** taskId → (subtaskId → new slot, or null when it doesn't fit before the deadline) */
  partSlots: Map<string, Map<string, Interval | null>>;
  /** One block for each task that has no parts. */
  blocks: Array<{ taskId: string; start: number; end: number }>;
  /** Tasks (or parts of them) that can't fit before their deadline. */
  unplaced: Task[];
  /** Big tasks still waiting for the AI to split them into parts. */
  awaitingSplit: string[];
}

/**
 * Re-plan every active task from scratch, strictly by earliest deadline, then priority:
 * each task takes the best free time left by the ones before it, so urgent work claims the early
 * slots and the rest is pushed to later slots or days. Times the user fixed by hand (`fixed`,
 * pinned parts) never move. Pure and deterministic.
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
  shortBreaks?: boolean;
}): PlanResult {
  const result: PlanResult = { partSlots: new Map(), blocks: [], unplaced: [], awaitingSplit: [] };
  const occupied: Interval[] = [...o.fixed];
  const span = (s: Subtask): Interval | null =>
    s.scheduledStart && s.scheduledEnd ? { start: Date.parse(s.scheduledStart), end: Date.parse(s.scheduledEnd) } : null;

  // Parts the user pinned stay where they are: everything else plans around them.
  for (const t of o.tasks) {
    for (const s of t.subtasks ?? []) {
      const iv = !s.completed && s.pinned ? span(s) : null;
      if (iv && iv.end > o.nowMs) occupied.push(iv);
    }
  }

  const common = { nowMs: o.nowMs, tz: o.tz, settings: o.settings, shortBreaks: o.shortBreaks };
  for (const t of planningOrder(o.tasks)) {
    const deadlineMs = Date.parse(t.deadline);
    if (deadlineMs <= o.nowMs + 30 * 60_000) continue; // about to expire: nothing useful to plan

    const parts = (t.subtasks ?? [])
      .filter((s) => !s.completed && !(s.pinned && span(s)))
      .map((s, i) => ({ s, i }))
      .sort((a, b) => (a.s.scheduledStart ?? "9").localeCompare(b.s.scheduledStart ?? "9") || a.i - b.i)
      .map((x) => x.s);

    if (t.subtasks?.length) {
      if (parts.length === 0) continue;
      const slots = placeParts({
        ...common, deadlineMs, busy: occupied,
        parts: parts.map((s) => ({ title: s.title, durationMin: s.durationMinutes })),
      });
      const byId = new Map<string, Interval | null>();
      parts.forEach((s, i) => {
        byId.set(s.id, slots[i]);
        if (slots[i]) occupied.push(slots[i]!);
      });
      result.partSlots.set(t.id, byId);
      if (slots.some((x) => !x)) result.unplaced.push(t);
      continue;
    }

    if (o.hasFixedBlock.has(t.id)) continue;
    if (needsDecomposition(t)) {
      result.awaitingSplit.push(t.id);
      continue;
    }
    const total = effectiveDuration(t) ?? o.settings.defaultTaskMinutes;
    const remaining = Math.min(DAY_LOAD_CAP_MIN, Math.max(15, total - (t.loggedMinutes ?? 0)));
    const [slot] = placeParts({ ...common, deadlineMs, busy: occupied, parts: [{ title: t.title, durationMin: remaining }] });
    if (slot) {
      occupied.push(slot);
      result.blocks.push({ taskId: t.id, ...slot });
    } else {
      result.unplaced.push(t);
    }
  }
  return result;
}
