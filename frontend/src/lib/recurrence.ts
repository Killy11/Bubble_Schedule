import type { ISODateTime, Recurrence } from "@/types";
import { addDays, dateKeyInTz, localNaiveToUtc, toLocalNaive, weekdayOf } from "./time";

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weekdays (0–6, Sun=0) a rule fires on. `deadlineDow` anchors "weekly" and an empty custom list. */
export function recurrenceDays(r: Recurrence, deadlineDow: number): number[] {
  switch (r.type) {
    case "daily":
      return ALL_DAYS;
    case "weekdays":
      return WEEKDAYS;
    case "weekly":
      return [deadlineDow];
    case "custom": {
      const days = [...new Set((r.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))];
      return days.length ? days.sort() : [deadlineDow];
    }
  }
}

export function recurrenceLabel(r: Recurrence): string {
  switch (r.type) {
    case "daily":
      return "Daily";
    case "weekdays":
      return "Weekdays";
    case "weekly":
      return "Weekly";
    case "custom": {
      const days = recurrenceDays(r, 0);
      return days.length === 7 ? "Daily" : [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_LABELS[d]).join(", ");
    }
  }
}

/** Parse untrusted data into a Recurrence (or undefined). */
export function cleanRecurrence(r: Recurrence | null | undefined): Recurrence | undefined {
  if (!r) return undefined;
  if (r.type === "custom") return { type: "custom", days: recurrenceDays(r, 1) };
  return { type: r.type };
}

/**
 * The next occurrence after a task with `deadline`: the first matching local day after the
 * deadline's day, never in the past (an overdue task doesn't produce an already-expired copy),
 * at the same local time of day. `dateKey` is the local day, used to build a deterministic id.
 */
export function nextOccurrence(
  deadline: ISODateTime,
  r: Recurrence,
  tz: string,
  nowMs: number,
): { deadline: ISODateTime; dateKey: string } | null {
  const local = toLocalNaive(deadline, tz);
  const baseKey = local.slice(0, 10);
  const time = local.slice(11);
  const days = recurrenceDays(r, weekdayOf(baseKey));
  let start = addDays(baseKey, 1);
  const today = dateKeyInTz(nowMs, tz);
  if (start < today) start = today;
  for (let i = 0; i < 14; i++) {
    const key = addDays(start, i);
    if (!days.includes(weekdayOf(key))) continue;
    const at = localNaiveToUtc(`${key}T${time}`, tz);
    if (at && at.getTime() > nowMs) return { deadline: at.toISOString(), dateKey: key };
  }
  return null;
}
