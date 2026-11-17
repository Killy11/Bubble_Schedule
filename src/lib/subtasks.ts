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

/** "45m", "1h", "1h 15m". */
export function formatDuration(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function needsDecomposition(t: Task): boolean {
  if (t.status !== "active" || t.subtasks?.length || t.subtasksAttempted) return false;
  if (t.requestedParts) return true; // the user asked for it explicitly
  const at = DECOMPOSE_AT_MIN[pacingOf(t)];
  return at !== null && (effectiveDuration(t) ?? 0) >= at;
}

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** "Today", "Tomorrow" or "Nov 20" for a device-local day. */
function dayWord(ms: number, now: number): string {
  const diff = Math.round((dayStart(ms) - dayStart(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** "Tomorrow, 14:00 – 15:15" (or "Not scheduled"). */
export function formatWindow(s: Subtask, now: number): string {
  if (!s.scheduledStart || !s.scheduledEnd) return "Not scheduled";
  return `${dayWord(Date.parse(s.scheduledStart), now)}, ${formatTime(s.scheduledStart)} – ${formatTime(s.scheduledEnd)}`;
}

/** The next part to work on: the earliest unfinished one (scheduled ones first, by time). */
export function nextSubtask(subtasks: readonly Subtask[]): Subtask | undefined {
  return subtasks
    .filter((s) => !s.completed)
    .sort((a, b) => (a.scheduledStart ?? "9").localeCompare(b.scheduledStart ?? "9"))[0];
}

export function subtaskProgress(t: Task): { done: number; total: number; next?: Subtask } | null {
  const subs = t.subtasks;
  if (!subs?.length) return null;
  return { done: subs.filter((s) => s.completed).length, total: subs.length, next: nextSubtask(subs) };
}

/** "2/6 parts · Next: Today, 18:00 – 19:30" */
export function progressLabel(t: Task, now: number): string | null {
  const p = subtaskProgress(t);
  if (!p) return null;
  if (!p.next) return `${p.done}/${p.total} parts · all done`;
  return `${p.done}/${p.total} parts · Next: ${formatWindow(p.next, now)}`;
}
