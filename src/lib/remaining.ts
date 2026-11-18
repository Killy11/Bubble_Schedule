import { effectiveDuration } from "@/lib/bubbles/effective";
import type { Task } from "@/types";

export const DEFAULT_TASK_MIN = 30;
export const STEP_MIN = 15;
export const MIN_REMAINING_MIN = 5;

/** Total planned minutes (the user's value, the AI estimate, or the 30-minute default). */
export const totalMinutes = (t: Task): number => effectiveDuration(t) ?? DEFAULT_TASK_MIN;

/** Minutes of work still left, ignoring a running timer. */
export const remainingMinutes = (t: Task): number => Math.max(0, totalMinutes(t) - (t.loggedMinutes ?? 0));

/** Milliseconds left right now: planned time minus logged time minus the running timer. Can reach 0, never below. */
export function remainingMs(t: Task, nowMs: number): number {
  const running = t.startedAt ? Math.max(0, nowMs - Date.parse(t.startedAt)) : 0;
  return Math.max(0, remainingMinutes(t) * 60_000 - running);
}

/** "24:15" or "1:05:00". */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}

/** Fraction of the planned time already used (0–1), counting a running timer. */
export function progressOf(t: Task, nowMs: number): number {
  const total = totalMinutes(t) * 60_000;
  return total > 0 ? Math.min(1, Math.max(0, 1 - remainingMs(t, nowMs) / total)) : 0;
}
