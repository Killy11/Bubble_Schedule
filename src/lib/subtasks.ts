import type { Subtask, Task } from "@/types";
import { effectiveDuration } from "@/lib/bubbles/effective";
import { formatTime } from "@/lib/time";

/** Tasks estimated above this many minutes are split into parts automatically. */
export const DECOMPOSE_OVER_MIN = 120;
export const MAX_SUBTASKS = 12;

export const newSubtaskId = (): string => Math.random().toString(36).slice(2, 10);

/** "45 min", "1h", "1h 15m". */
export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h === 0) return `${m} min`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export const needsDecomposition = (t: Task): boolean =>
  t.status === "active" &&
  !t.subtasks?.length &&
  !t.subtasksAttempted &&
  (effectiveDuration(t) ?? 0) > DECOMPOSE_OVER_MIN;

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
