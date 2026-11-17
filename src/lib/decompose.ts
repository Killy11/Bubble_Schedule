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
const GAP_MIN = 10; // breathing room between two parts on the same day
const MAX_DAY_MIN = 240; // never more than 4 h of one task in a single day (unless nothing else fits)
const MAX_DAYS = 30;

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

/** Free working-time windows per day, from now until the task must be finished. */
function freeWindows(o: {
  nowMs: number;
  limitMs: number;
  tz: string;
  settings: UserSettings;
  busy: Interval[];
}): Interval[][] {
  const { nowMs, limitMs, tz, settings } = o;
  const days: Interval[][] = [];
  let key = dateKeyInTz(nowMs, tz);
  const lastKey = dateKeyInTz(limitMs, tz);
  for (let i = 0; i < MAX_DAYS && key <= lastKey; i++, key = addDays(key, 1)) {
    if (!settings.workingDays.includes(weekdayOf(key))) continue;
    const ws = localNaiveToUtc(`${key}T${settings.workingHours.start}`, tz)?.getTime();
    const we = localNaiveToUtc(`${key}T${settings.workingHours.end}`, tz)?.getTime();
    if (ws === undefined || we === undefined) continue;
    const from = Math.max(ws, ceil5(nowMs));
    const to = Math.min(we, limitMs);
    if (to - from < 15 * MIN) continue;
    const windows = subtract([{ start: from, end: to }], o.busy).filter((w) => w.end - w.start >= 15 * MIN);
    if (windows.length) days.push(windows);
  }
  return days;
}

function tryPlace(parts: Part[], days: Interval[][], capMin: number): Array<Interval | null> {
  const slots: Array<Interval | null> = [];
  const used = days.map(() => 0);
  let day = 0;
  let cursor = 0;
  for (const part of parts) {
    let placed: Interval | null = null;
    for (; day < days.length && !placed; day++) {
      for (const w of days[day]) {
        const start = ceil5(Math.max(w.start, cursor));
        const end = start + part.durationMin * MIN;
        if (end <= w.end && used[day] + part.durationMin <= capMin) {
          placed = { start, end };
          used[day] += part.durationMin;
          cursor = end + GAP_MIN * MIN;
          break;
        }
      }
      if (placed) break;
    }
    // `day` points at the day just used (the for-loop's increment is skipped by `break`).
    slots.push(placed);
    if (!placed) day = days.length; // parts are sequential: once one doesn't fit, the rest can't either
  }
  return slots;
}

/**
 * Give each part (in order) a time slot inside working hours, before the deadline and clear of
 * `busy`. Work is spread over the available days (a per-day cap), never one marathon block; if that
 * doesn't fit, the cap is relaxed step by step. A part that doesn't fit gets `null`.
 */
export function placeParts(o: {
  parts: Part[];
  nowMs: number;
  deadlineMs: number;
  tz: string;
  settings: UserSettings;
  busy: Interval[];
}): Array<Interval | null> {
  const total = o.parts.reduce((s, p) => s + p.durationMin, 0);
  const limit = latestEndMs(o.deadlineMs, o.nowMs, total);
  const days = freeWindows({ ...o, limitMs: limit });
  if (days.length === 0) return o.parts.map(() => null);

  const longest = Math.max(...o.parts.map((p) => p.durationMin));
  const even = Math.max(longest, Math.ceil(total / days.length));
  let best: Array<Interval | null> = o.parts.map(() => null);
  for (const cap of [...new Set([Math.min(even, MAX_DAY_MIN), 180, MAX_DAY_MIN, 480])].sort((a, b) => a - b)) {
    if (cap < longest) continue;
    const slots = tryPlace(o.parts, days, cap);
    if (slots.filter(Boolean).length > best.filter(Boolean).length) best = slots;
    if (slots.every(Boolean)) return slots;
  }
  return best;
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
