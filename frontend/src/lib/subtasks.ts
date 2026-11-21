import type { Pacing, Subtask, Task } from "@/types";
import { pacingOf } from "@/lib/pacing";
import { effectiveDuration } from "@/lib/bubbles/effective";
import { formatTime } from "@/lib/time";

/**
 * Duration (minutes) from which a task is split into parts automatically, by pacing:
 * Balanced from 3 h, Chill from 90 min, Locked-in never (only when the user says how many parts).
 */
export const DECOMPOSE_AT_MIN: Record<Pacing, number | null> = { balanced: 180, chill: 90, locked: null };
/** Target length of an automatic part. */
export const PART_TARGET_MIN = 60;
export const MAX_SUBTASKS = 12;

export const newSubtaskId = (): string => Math.random().toString(36).slice(2, 10);

type Tr = (en: string, vars?: Record<string, string | number>) => string;
const same: Tr = (en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? "")) : en);

/** "45m", "1h", "1h 15m" (units translated when `t` is given). */
export function formatDuration(min: number, t: Tr = same): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return t("{n}m", { n: m });
  return m ? `${t("{n}h", { n: h })} ${t("{n}m", { n: m })}` : t("{n}h", { n: h });
}

export function needsDecomposition(t: Task): boolean {
  if (t.status !== "active" || t.subtasks?.length || t.subtasksAttempted) return false;
  if (t.requestedParts) return true; // the user asked for it explicitly
  const at = DECOMPOSE_AT_MIN[pacingOf(t)];
  return at !== null && (effectiveDuration(t) ?? 0) >= at;
}

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** "Today", "Tomorrow" or "Nov 20" for a device-local day. */
function dayWord(ms: number, now: number, t: Tr, locale?: string): string {
  const diff = Math.round((dayStart(ms) - dayStart(now)) / 86_400_000);
  if (diff === 0) return t("Today");
  if (diff === 1) return t("Tomorrow");
  if (diff === -1) return t("Yesterday");
  return new Date(ms).toLocaleDateString(locale ? [locale] : [], { month: "short", day: "numeric" });
}

/** "Tomorrow, 14:00 – 15:15" (or "Not scheduled"). */
export function formatWindow(s: Subtask, now: number, t: Tr = same, locale?: string): string {
  if (!s.scheduledStart || !s.scheduledEnd) return t("Not scheduled");
  return `${dayWord(Date.parse(s.scheduledStart), now, t, locale)}, ${formatTime(s.scheduledStart)} – ${formatTime(s.scheduledEnd)}`;
}

/** The next part to work on: the earliest unfinished one (scheduled ones first, by time). */
export function nextSubtask(subtasks: readonly Subtask[]): Subtask | undefined {
  return subtasks.find((s) => !s.completed); // the next step in logical order
}

export function subtaskProgress(t: Task): { done: number; total: number; next?: Subtask } | null {
  const subs = t.subtasks;
  if (!subs?.length) return null;
  return { done: subs.filter((s) => s.completed).length, total: subs.length, next: nextSubtask(subs) };
}

/** "2/6 parts · Next: Today, 18:00 – 19:30" */
export function progressLabel(task: Task, now: number, t: Tr = same, locale?: string): string | null {
  const p = subtaskProgress(task);
  if (!p) return null;
  if (!p.next) return `${p.done}/${p.total} ${t("parts")} · ${t("all done")}`;
  return `${p.done}/${p.total} ${t("parts")} · ${t("Next")}: ${formatWindow(p.next, now, t, locale)}`;
}

/**
 * The task's total duration changed: rescale its open parts so that all parts add up to the new total
 * (completed parts keep their time). 5-minute steps, at least 5 each; the last part takes the rounding remainder.
 * A pinned part keeps its start and its window follows its new length.
 */
export function scaleSubtasks(
  subtasks: readonly Subtask[],
  totalMin: number,
  /** The pacing's split threshold (e.g. 180 min): above it the task needs more parts, ~PART_TARGET_MIN each. */
  splitAtMin: number | null = null,
  /** Title base for parts added by a re-split. */
  title = "",
): Subtask[] {
  let open = subtasks.filter((s) => !s.completed);
  if (open.length === 0) return [...subtasks];
  const doneMin = subtasks.filter((s) => s.completed).reduce((n, s) => n + s.durationMinutes, 0);
  const target = Math.max(5 * open.length, Math.round(totalMin - doneMin));
  // Shrinking: when the parts would become fragments (< 40 min), merge them into ~50-minute blocks.
  // Unpinned parts from the end go first; the remaining time is spread over the parts that stay.
  if ((totalMin - doneMin) / open.length < 40 && open.length > 1) {
    const keep = Math.max(1, Math.round((totalMin - doneMin) / 50));
    const drop = new Set<string>();
    for (const s of [...open].reverse()) {
      if (open.length - drop.size <= keep) break;
      if (!s.pinned) drop.add(s.id);
    }
    if (drop.size) {
      const rest = subtasks.filter((s) => !drop.has(s.id));
      return scaleSubtasks(rest, totalMin, null, title);
    }
  }
  // Over the split threshold (3 h for Balanced): grow the number of parts, never shrink it, keep finished parts.
  const want = splitAtMin && totalMin > splitAtMin ? Math.min(MAX_SUBTASKS - (subtasks.length - open.length), Math.ceil(target / PART_TARGET_MIN)) : 0;
  if (want > open.length) {
    const added: Subtask[] = Array.from({ length: want - open.length }, (_, i) => ({
      id: newSubtaskId(), title: `${title} · ${subtasks.length + i + 1}`.trim(), durationMinutes: 5, completed: false,
    }));
    const per = Math.max(5, Math.floor(target / want / 5) * 5);
    // New steps go BEFORE the last open one, so the closing step (final self-test) stays last and the order stays logical.
    const lastOpen = subtasks.map((s) => !s.completed).lastIndexOf(true);
    const grown = lastOpen > 0 && open.length >= 2
      ? [...subtasks.slice(0, lastOpen), ...added, ...subtasks.slice(lastOpen)]
      : [...subtasks, ...added];
    open = grown.filter((s) => !s.completed);
    let used = 0;
    const next = new Map<string, number>();
    open.forEach((s, i) => {
      const d = i === open.length - 1 ? Math.max(5, target - used) : per;
      next.set(s.id, d);
      used += d;
    });
    return grown.map((s) => {
      const d = next.get(s.id);
      if (d === undefined) return s;
      const pinnedSpan = s.pinned && s.scheduledStart;
      return { ...s, durationMinutes: d, ...(pinnedSpan ? { scheduledEnd: new Date(Date.parse(s.scheduledStart!) + d * 60_000).toISOString() } : {}) };
    });
  }
  const sum = open.reduce((n, s) => n + s.durationMinutes, 0) || open.length;
  const next = new Map<string, number>();
  let used = 0;
  open.forEach((s, i) => {
    const d =
      i === open.length - 1
        ? Math.max(5, target - used)
        : Math.max(5, Math.round(((s.durationMinutes / sum) * target) / 5) * 5);
    next.set(s.id, d);
    used += d;
  });
  return subtasks.map((s) => {
    const d = next.get(s.id);
    if (d === undefined || d === s.durationMinutes) return s;
    const pinnedSpan = s.pinned && s.scheduledStart;
    return {
      ...s,
      durationMinutes: d,
      ...(pinnedSpan ? { scheduledEnd: new Date(Date.parse(s.scheduledStart!) + d * 60_000).toISOString() } : {}),
    };
  });
}
