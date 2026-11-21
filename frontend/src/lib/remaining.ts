import { effectiveDuration } from "@/lib/bubbles/effective";
import type { Task } from "@/types";

export const DEFAULT_TASK_MIN = 30;
export const STEP_MIN = 15;
export const MIN_REMAINING_MIN = 1;
export const MAX_TOTAL_MIN = 9999 * 60;

/**
 * Time model (whole minutes are the stored truth; seconds exist only while a timer session is open):
 *  - total      = the user's duration, the AI estimate, or 30 min
 *  - spent      = `loggedMinutes`
 *  - remaining  = max(0, total − spent)
 *  - a session  = `accumulatedSeconds` (paused time) + now − `startedAt` (while running), measured with real epoch
 *                 timestamps, so a background tab or a locked phone keeps exact time.
 * "Stop & confirm" turns the session into whole minutes, rounded DOWN, and adds them to `loggedMinutes`.
 */
export const totalMinutes = (t: Task): number => effectiveDuration(t) ?? DEFAULT_TASK_MIN;
export const spentMinutes = (t: Task): number => t.loggedMinutes ?? 0;
export const remainingMinutes = (t: Task): number => Math.max(0, totalMinutes(t) - spentMinutes(t));

/** Seconds of the open timer session (paused part + the running part). */
export function sessionSeconds(t: Task, nowMs: number): number {
  const running = t.startedAt ? Math.max(0, (nowMs - Date.parse(t.startedAt)) / 1000) : 0;
  return (t.accumulatedSeconds ?? 0) + running;
}

/** Whole minutes a session is worth: rounded down (03:40 → 3, 00:40 → 0). */
export const sessionMinutes = (t: Task, nowMs: number): number => Math.floor(sessionSeconds(t, nowMs) / 60);

/** Live countdown: the remaining minutes minus the open session, never below 0. */
export const remainingSeconds = (t: Task, nowMs: number): number => Math.max(0, remainingMinutes(t) * 60 - sessionSeconds(t, nowMs));
export const remainingMs = (t: Task, nowMs: number): number => remainingSeconds(t, nowMs) * 1000;

/** The epoch time at which a RUNNING timer's countdown reaches 00:00 (null when it isn't running). */
export function targetEndAt(t: Task): number | null {
  if (!t.startedAt) return null;
  return Date.parse(t.startedAt) + (remainingMinutes(t) * 60 - (t.accumulatedSeconds ?? 0)) * 1000;
}

/** Fraction of the planned time used (0–1), counting the open session. */
export function progressOf(t: Task, nowMs: number): number {
  const total = totalMinutes(t) * 60;
  return total > 0 ? Math.min(1, Math.max(0, (spentMinutes(t) * 60 + sessionSeconds(t, nowMs)) / total)) : 0;
}

/** "24:15" or "1:05:00" (MM:SS, or H:MM:SS from one hour). Display only: nobody types seconds. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}
