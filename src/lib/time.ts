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

/** "Today 14:30", "Tomorrow 09:00", "Nov 18, 09:00", or "Overdue". */
export function formatDeadline(iso: ISODateTime, now: number): string {
  const d = new Date(iso);
  if (d.getTime() < now) return "Overdue";
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(d.getTime()) - startOfDay(now)) / 86_400_000);
  const time = formatTime(iso);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** DateKey n days after `key` (calendar arithmetic, DST-safe). */
export function addDays(key: DateKey, n: number): DateKey {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
