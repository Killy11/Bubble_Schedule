import { effectiveDuration } from "@/lib/bubbles/effective";
import type { Task } from "@/types";

export const DEFAULT_TASK_MIN = 30;
export const STEP_MIN = 15;
export const MIN_REMAINING_SEC = 5 * 60;
export const MAX_TOTAL_SEC = 24 * 3600;

/**
 * Time model, in whole seconds:
 *  - total     = `durationSeconds` when it agrees with `durationMin`, else (durationMin or the AI estimate or 30 min) × 60
 *  - spent     = the larger of `spentSeconds` and `loggedMinutes` × 60 (other code still adds whole minutes), plus a running timer
 *  - remaining = total − spent, never below 0
 * `durationMin` / `loggedMinutes` stay in sync (ceil / floor) so the planner and bubble sizes keep working in minutes.
 */
export function totalSeconds(t: Task): number {
  if (t.durationSeconds && t.durationMin !== undefined && Math.ceil(t.durationSeconds / 60) === t.durationMin) return t.durationSeconds;
  return (effectiveDuration(t) ?? DEFAULT_TASK_MIN) * 60;
}

/** Seconds spent, not counting a timer that is running right now. */
export const savedSpentSeconds = (t: Task): number => Math.max(t.spentSeconds ?? 0, (t.loggedMinutes ?? 0) * 60);

export function spentSeconds(t: Task, nowMs: number): number {
  const running = t.startedAt ? Math.max(0, (nowMs - Date.parse(t.startedAt)) / 1000) : 0;
  return savedSpentSeconds(t) + running;
}

export const remainingSeconds = (t: Task, nowMs: number): number => Math.max(0, totalSeconds(t) - spentSeconds(t, nowMs));
export const remainingMs = (t: Task, nowMs: number): number => remainingSeconds(t, nowMs) * 1000;

/** Whole minutes left (rounded up), ignoring a running timer. */
export const remainingMinutes = (t: Task): number => Math.ceil(Math.max(0, totalSeconds(t) - savedSpentSeconds(t)) / 60);

/** Fraction of the planned time used (0–1), counting a running timer. */
export function progressOf(t: Task, nowMs: number): number {
  const total = totalSeconds(t);
  return total > 0 ? Math.min(1, Math.max(0, spentSeconds(t, nowMs) / total)) : 0;
}

/** "24:15" or "1:05:00" (MM:SS, or H:MM:SS from one hour). */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s % 60)}` : `${p(m)}:${p(s % 60)}`;
}

/**
 * Parse a typed duration into seconds: "14:23" (mm:ss), "1:02:03" (h:mm:ss), "45s", "12.5" (minutes) or "45".
 * Anything above zero is valid, including sub-minute values. Returns null when it isn't a duration.
 */
export function parseClock(text: string): number | null {
  const v = text.trim().toLowerCase().replace(",", ".");
  if (!v) return null;
  let sec: number;
  if (v.includes(":")) {
    const parts = v.split(":").map(Number);
    if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
    sec = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (/^\d+(\\.\d+)?s$/.test(v)) {
    sec = parseFloat(v);
  } else if (/^\d+(\\.\d+)?m?$/.test(v)) {
    sec = parseFloat(v) * 60;
  } else {
    return null;
  }
  sec = Math.round(sec);
  return sec > 0 && sec <= MAX_TOTAL_SEC ? sec : null;
}

/** The fields to store so seconds survive a reload and the minute fields stay in step. */
export function secondsPatch(total: number, spent: number) {
  const tot = Math.max(1, Math.round(total));
  const sp = Math.max(0, Math.round(spent));
  return {
    durationSeconds: tot,
    durationMin: Math.ceil(tot / 60),
    spentSeconds: sp,
    remainingSeconds: Math.max(0, tot - sp),
    loggedMinutes: Math.floor(sp / 60),
  };
}
