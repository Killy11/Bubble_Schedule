import type { UserSettings } from "@/types";

/**
 * Earlier versions defaulted to 09:00–18:00. The active day is now 09:00–21:00, so anyone still on
 * the old default (most likely never changed it) gets the longer day; any other hours are kept.
 */
export function upgradeWorkingHours(wh: UserSettings["workingHours"]): UserSettings["workingHours"] {
  return wh.start === "09:00" && wh.end === "18:00" ? { start: "09:00", end: "21:00" } : wh;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_QUIET = { start: "22:00", end: "08:00" };

/** Quiet hours the schedule implies: from the end of the working day to its start. */
export function derivedQuiet(s: { workingHours?: { start?: string; end?: string } } | undefined): { start: string; end: string } {
  const wh = s?.workingHours;
  return wh && HHMM.test(wh.start ?? "") && HHMM.test(wh.end ?? "") && wh.start !== wh.end
    ? { start: wh.end!, end: wh.start! }
    : DEFAULT_QUIET;
}

/** The quiet-hours window in force: the user's own times if customised, otherwise derived from the schedule. */
export function effectiveQuiet(s: Partial<UserSettings> | undefined): { enabled: boolean; custom: boolean; start: string; end: string } {
  const custom = s?.quietHoursCustom === true;
  const own = custom && HHMM.test(s?.quietHoursStart ?? "") && HHMM.test(s?.quietHoursEnd ?? "");
  const base = own ? { start: s!.quietHoursStart!, end: s!.quietHoursEnd! } : derivedQuiet(s);
  return { enabled: s?.quietHoursEnabled ?? s?.quietHours?.enabled ?? false, custom: own, ...base };
}
