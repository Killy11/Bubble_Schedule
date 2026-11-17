import type { UserSettings } from "@/types";
import { addDays, dateKeyInTz, localNaiveToUtc, weekdayOf } from "@/lib/time";
import { latestEndMs } from "@/lib/ai/horizon";

export interface Interval {
  start: number;
  end: number;
}
export interface Part {
  title: string;
  durationMin: number;
}

const MIN = 60_000;
export const BREAK_DEFAULT_MIN = 30;
export const BREAK_SHORT_MIN = 10;
/** Scheduled work per day, all tasks together (4.5 h): the rest of the working day stays free. */
export const DAY_LOAD_CAP_MIN = 270;
const MAX_DAYS = 30;

/** Rest after a block: 30 min (45 after 90+ min of work), or 10 min when the user asked for short breaks. */
export const breakFor = (durationMin: number, short = false): number =>
  short ? BREAK_SHORT_MIN : durationMin >= 90 ? 45 : BREAK_DEFAULT_MIN;

/** Cut `busy` intervals out of `free`. Both lists may be unsorted. */
function subtract(free: Interval[], busy: Interval[]): Interval[] {
  let out = free;
  for (const b of busy) {
    out = out.flatMap((f) => {
      if (b.end <= f.start || b.start >= f.end) return [f];
      const parts: Interval[] = [];
      if (b.start > f.start) parts.push({ start: f.start, end: b.start });
      if (b.end < f.end) parts.push({ start: b.end, end: f.end });
      return parts;
    });
  }
  return out.sort((a, c) => a.start - c.start);
}

const ceil5 = (ms: number) => Math.ceil(ms / (5 * MIN)) * 5 * MIN;

export interface PlaceOpts {
  nowMs: number;
  deadlineMs: number;
  tz: string;
  settings: UserSettings;
  /** Everything already occupying time (other tasks, pinned blocks). Breaks are added around it. */
  busy: Interval[];
  /** The user asked for short breaks / back-to-back work. */
  shortBreaks?: boolean;
}

interface Day {
  windows: Interval[]; // free working time, with breaks around busy time already carved out
  capacity: number; // minutes of NEW work this day can still take (daily cap minus what's booked)
}

/** Free working-time windows per day, from now until `limitMs`. */
function buildDays(o: PlaceOpts, limitMs: number): Day[] {
  const { nowMs, tz, settings } = o;
  const short = !!o.shortBreaks;
  const padded = o.busy.map((b) => ({
    start: b.start - (short ? BREAK_SHORT_MIN : BREAK_DEFAULT_MIN) * MIN,
    end: b.end + breakFor((b.end - b.start) / MIN, short) * MIN,
  }));
  const days: Day[] = [];
  let key = dateKeyInTz(nowMs, tz);
  const lastKey = dateKeyInTz(limitMs, tz);
  for (let i = 0; i < MAX_DAYS && key <= lastKey; i++, key = addDays(key, 1)) {
    if (!settings.workingDays.includes(weekdayOf(key))) continue;
    const ws = localNaiveToUtc(`${key}T${settings.workingHours.start}`, tz)?.getTime();
    const we = localNaiveToUtc(`${key}T${settings.workingHours.end}`, tz)?.getTime();
    if (ws === undefined || we === undefined) continue;
    const booked = o.busy.reduce((sum, b) => sum + Math.max(0, Math.min(we, b.end) - Math.max(ws, b.start)), 0) / MIN;
    const from = Math.max(ws, ceil5(nowMs));
    const to = Math.min(we, limitMs);
    if (to - from < 15 * MIN) continue;
    const windows = subtract([{ start: from, end: to }], padded).filter((w) => w.end - w.start >= 15 * MIN);
    const capacity = DAY_LOAD_CAP_MIN - booked;
    if (windows.length && capacity >= 15) days.push({ windows, capacity });
  }
  return days;
}

/**
 * Give each part (in order) a time slot inside working hours, strictly before the deadline, clear of
 * `busy` and with breaks in between (30–45 min by default). Parts are spread evenly over the
 * available days up to the deadline (about total/days per day, 1–2 sessions rather than a pile on
 * day one) and a day never takes more than the daily cap. A part that doesn't fit gets `null`.
 */
export function placeParts(o: PlaceOpts & { parts: Part[] }): Array<Interval | null> {
  const short = !!o.shortBreaks;
  const total = o.parts.reduce((s, p) => s + p.durationMin, 0);
  const none = o.parts.map(() => null);
  if (o.parts.length === 0) return [];
  // The last part must end before the deadline (with a safety margin).
  const limit = Math.min(latestEndMs(o.deadlineMs, o.nowMs, total), o.deadlineMs - 5 * MIN);
  const shortest = Math.min(...o.parts.map((p) => p.durationMin));
  const days = buildDays(o, limit).filter(
    (d) => d.capacity >= shortest && d.windows.some((w) => w.end - w.start >= shortest * MIN),
  );
  if (days.length === 0) return none;

  const spread = Math.min(days.length, o.parts.length); // days the work is spread over
  const used = days.map(() => 0);
  const slots: Array<Interval | null> = [];
  let dayIdx = 0;
  let cursor = 0;
  let before = 0;
  for (const part of o.parts) {
    // Day this part belongs to if the work is spread evenly (front-loaded: by where it starts).
    const wanted = Math.min(spread - 1, Math.floor((before / total) * spread));
    before += part.durationMin;
    let placed: Interval | null = null;
    for (let d = Math.max(wanted, dayIdx); d < days.length && !placed; d++) {
      if (used[d] + part.durationMin > days[d].capacity) continue;
      for (const w of days[d].windows) {
        const start = ceil5(Math.max(w.start, cursor));
        const end = start + part.durationMin * MIN;
        if (end <= w.end) {
          placed = { start, end };
          used[d] += part.durationMin;
          dayIdx = d;
          cursor = end + breakFor(part.durationMin, short) * MIN;
          break;
        }
      }
    }
    slots.push(placed);
  }
  return slots;
}

const round5 = (n: number) => Math.round(n / 5) * 5;

/**
 * Clean up the model's parts: sensible titles, 15–120 min each, and a total that matches the task
 * (the model's durations are scaled to `totalMin`).
 */
export function normalizeParts(raw: Array<{ title?: unknown; durationMin?: unknown }>, totalMin: number, max: number): Part[] {
  const parts = raw
    .slice(0, max)
    .map((p) => ({
      title: String(p.title ?? "").replace(/\s+/g, " ").trim().slice(0, 100),
      durationMin: Number(p.durationMin),
    }))
    .filter((p) => p.title && Number.isFinite(p.durationMin) && p.durationMin > 0);
  if (parts.length < 2) return [];
  const sum = parts.reduce((s, p) => s + p.durationMin, 0);
  const k = totalMin / sum;
  return parts.map((p) => ({ title: p.title, durationMin: Math.max(15, Math.min(120, round5(p.durationMin * k))) }));
}

/** Plain split used when the AI is unavailable: equal ~75-minute parts. */
export function fallbackParts(title: string, totalMin: number, max: number): Part[] {
  const n = Math.min(max, Math.max(2, Math.ceil(totalMin / 75)));
  const each = Math.max(15, Math.min(120, round5(totalMin / n)));
  return Array.from({ length: n }, (_, i) => ({
    title: `${title.slice(0, 85)} (part ${i + 1}/${n})`,
    durationMin: each,
  }));
}
