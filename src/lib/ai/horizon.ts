import type { DateKey, UserSettings } from "@/types";
import { addDays, minutesOfDay, weekdayOf } from "@/lib/time";
import { upgradeWorkingHours } from "@/lib/settings";

/** How many calendar days ahead (including the target day) the planner may use. */
export const HORIZON_DAYS = 7;
const MAX_BUFFER_MIN = 180;

/** Working hours / days from the user's doc, repaired if they are missing or nonsensical. */
export function sanitizeSettings(s: UserSettings): UserSettings {
  const ok = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const wh = s.workingHours;
  const hoursOk = ok(wh?.start) && ok(wh?.end) && minutesOfDay(wh.end) - minutesOfDay(wh.start) >= 30;
  const days = Array.isArray(s.workingDays) ? s.workingDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];
  return {
    ...s,
    workingHours: hoursOk ? upgradeWorkingHours(wh) : { start: "09:00", end: "21:00" },
    workingDays: days.length ? days : [0, 1, 2, 3, 4, 5, 6],
  };
}

/** Days the planner may schedule on: working weekdays within the horizon, starting at `target`. */
export function planningDays(target: DateKey, workingDays: number[]): DateKey[] {
  const out: DateKey[] = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const k = addDays(target, i);
    if (workingDays.includes(weekdayOf(k))) out.push(k);
  }
  return out;
}

/**
 * Latest moment a block for this task may END: the deadline minus a safety margin (10% of the time
 * left, at most 3 h). If the margin would leave no room for the task itself, the deadline is used.
 */
export function latestEndMs(deadlineMs: number, nowMs: number, durationMin: number): number {
  const buffer = Math.min(MAX_BUFFER_MIN * 60_000, Math.max(0, (deadlineMs - nowMs) * 0.1));
  const withBuffer = deadlineMs - buffer;
  return withBuffer - nowMs >= durationMin * 60_000 ? withBuffer : deadlineMs;
}
