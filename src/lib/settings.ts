import type { UserSettings } from "@/types";

/**
 * Earlier versions defaulted to 09:00–18:00. The active day is now 09:00–21:00, so anyone still on
 * the old default (most likely never changed it) gets the longer day; any other hours are kept.
 */
export function upgradeWorkingHours(wh: UserSettings["workingHours"]): UserSettings["workingHours"] {
  return wh.start === "09:00" && wh.end === "18:00" ? { start: "09:00", end: "21:00" } : wh;
}
