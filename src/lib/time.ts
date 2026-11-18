import type { DateKey, ISODateTime } from "@/types";

/** Parts of an instant as seen on a wall clock in `tz`. */
function wallParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" for an instant in `tz`. */
export function dateKeyInTz(date: Date | ISODateTime | number, tz: string): DateKey {
  const p = wallParts(new Date(date), tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
}

/** Wall-clock "YYYY-MM-DDTHH:mm" (no offset) for an instant in `tz`. */
export function toLocalNaive(date: Date | ISODateTime, tz: string): string {
  const p = wallParts(new Date(date), tz);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** Interpret a wall-clock "YYYY-MM-DDTHH:mm" in `tz` and return the UTC instant (null if malformed). */
export function localNaiveToUtc(naive: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(naive);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes handle DST boundaries.
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = wallParts(new Date(guess), tz);
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    guess += asUtc - shown;
  }
  return new Date(guess);
}

/** Minutes since midnight of a "YYYY-MM-DDTHH:mm" or "HH:mm" string. */
export function minutesOfDay(s: string): number {
  const t = s.includes("T") ? s.split("T")[1] : s;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** 0 (Sun) – 6 (Sat) for a DateKey. */
export function weekdayOf(key: DateKey): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function formatTime(iso: ISODateTime): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type Tr = (en: string, vars?: Record<string, string | number>) => string;
const same: Tr = (en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? "")) : en);

/** "5h ago" style age of a passed deadline. */
export function formatOverdue(iso: ISODateTime, now: number, t: Tr = same): string {
  const min = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60_000));
  const ago =
    min < 60 ? t("{n}m ago", { n: min }) : min < 24 * 60 ? t("{n}h ago", { n: Math.round(min / 60) }) : t("{n}d ago", { n: Math.round(min / (24 * 60)) });
  return t("Overdue · {ago}", { ago });
}

/** "Today 14:30", "Tomorrow 09:00", "Nov 18, 09:00", "No deadline", or "Overdue · 5h ago". */
export function formatDeadline(iso: ISODateTime | undefined, now: number, t: Tr = same, locale?: string): string {
  if (!iso) return t("No deadline");
  const d = new Date(iso);
  if (d.getTime() < now) return formatOverdue(iso, now, t);
  const startOfDay = (x: number) => new Date(x).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(d.getTime()) - startOfDay(now)) / 86_400_000);
  const time = formatTime(iso);
  if (days === 0) return `${t("Today")} ${time}`;
  if (days === 1) return `${t("Tomorrow")} ${time}`;
  return `${d.toLocaleDateString(locale ? [locale] : [], { month: "short", day: "numeric" })}, ${time}`;
}

/** DateKey n days after `key` (calendar arithmetic, DST-safe). */
export function addDays(key: DateKey, n: number): DateKey {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Strictly "HH:MM" (drops any ":ss"), so an `<input type="time" step="60">` never shows a seconds column or fails validation. */
export const hhmm = (v: string): string => (/^\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : v);
