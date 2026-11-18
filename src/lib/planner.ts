import type { Pacing, UserSettings } from "@/types";
import type { Tier } from "@/lib/priority";
import { addDays, dateKeyInTz, localNaiveToUtc, weekdayOf } from "@/lib/time";
import { latestEndMs } from "@/lib/ai/horizon";
import type { Interval } from "@/lib/decompose";

const MIN = 60_000;
const MAX_DAYS = 30;
const MAX_CHILL_SPREAD_DAYS = 10;

/** Active work per day, all tasks together. Locked-in work is exempt: it is an immovable sprint. */
export const DAY_CAP_MIN: Record<Pacing, number> = { chill: 180, balanced: 270, locked: Infinity };
/** Rest left around hand-pinned blocks and around locked-in blocks, so other work never touches them. */
const PAD_FIXED_MIN = 15;
const LOCKED_GAP_MIN = 5; // micro-break between back-to-back locked-in blocks

export interface PlanUnit {
  key: string;
  taskId: string;
  subId?: string;
  durationMin: number;
  deadlineMs: number;
  pacing: Pacing;
  /** Urgency tier: 0 red, 1 yellow, 2 green, 3 no deadline. */
  tier: Tier;
  /** Position in the planning order (earliest deadline first). */
  orderIdx: number;
  /** Order among the parts of one task, and how many parts it has. */
  seq: number;
  count: number;
}

const ceil5 = (ms: number) => Math.ceil(ms / (5 * MIN)) * 5 * MIN;

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
const pad = (iv: Interval, min: number): Interval => ({ start: iv.start - min * MIN, end: iv.end + min * MIN });
const overlap = (a: Interval, b: Interval) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * Rest after a focus block of `durationMin`.
 *  - Balanced, wave rhythm: 15 min after the first block of a cycle, 45–60 min once about two
 *    hours of focus have piled up (`cum` includes this block), then the cycle restarts.
 *  - Chill, recharge buffer: 30 min after short tasks (< 60 min), 45–60 after larger ones.
 */
export function restAfter(pacing: Pacing, durationMin: number, cum: number): { rest: number; cum: number } {
  if (pacing === "chill") return { rest: durationMin < 60 ? 30 : durationMin < 90 ? 45 : 60, cum: 0 };
  if (pacing === "locked") return { rest: LOCKED_GAP_MIN, cum: 0 };
  const total = cum + durationMin;
  if (total >= 100) return { rest: total >= 150 ? 60 : 45, cum: 0 };
  return { rest: 15, cum: total };
}

interface Day {
  start: number;
  /** End of normal working hours (== start when none are left). */
  end: number;
  /** End of the local day: the only place Red tasks may run past working hours. */
  dayEnd: number;
}

/** Green / no-deadline work is kept off Today unless Today is clearly light. */
const TODAY_LOW_PRIORITY_MAX_TASKS = 2;
const TODAY_LOW_PRIORITY_MAX_LOAD_MIN = 150;

/**
 * Chronological planner.
 *  Day by day, units go in priority order (urgency tier, then earliest due; focus intensity never
 *  reorders): the first unit that fits goes next, followed by its pacing's break. A Locked-in task,
 *  when its turn comes, is one unbroken block (requested parts chained with 5-minute gaps). A day stops at its load cap, and the parts
 *     of a task are spread over the days up to its deadline instead of piling on one day.
 * Returns the slot of every unit that fits (a unit that doesn't is simply missing).
 */
interface PlanInput {
  units: PlanUnit[];
  nowMs: number;
  tz: string;
  settings: UserSettings;
  fixed: Interval[];
}

/** Latest moment a unit may end. Red units may run right up to their real deadline, other units keep a safety margin. */
const limitFor = (u: PlanUnit, nowMs: number) =>
  u.tier === 0 ? u.deadlineMs : Math.min(latestEndMs(u.deadlineMs, nowMs, u.durationMin), u.deadlineMs - 5 * MIN);

/** The calendar: working windows from now until the latest deadline (at most 30 days). Red work may also use after-hours time. */
function buildDays(o: PlanInput): Day[] {
  const { nowMs, tz, settings } = o;
  const horizon = Math.min(Math.max(...o.units.map((u) => u.deadlineMs)), nowMs + MAX_DAYS * 24 * 60 * MIN);
  const lastRedDue = Math.max(0, ...o.units.filter((u) => u.tier === 0).map((u) => u.deadlineMs));
  const days: Day[] = [];
  let key = dateKeyInTz(nowMs, tz);
  const lastKey = dateKeyInTz(horizon, tz);
  for (let i = 0; i < MAX_DAYS + 1 && key <= lastKey; i++, key = addDays(key, 1)) {
    const ws = localNaiveToUtc(`${key}T${settings.workingHours.start}`, tz)?.getTime();
    const we = localNaiveToUtc(`${key}T${settings.workingHours.end}`, tz)?.getTime();
    const dayEnd = localNaiveToUtc(`${addDays(key, 1)}T00:00`, tz)?.getTime();
    if (ws === undefined || we === undefined || dayEnd === undefined) continue;
    const working = settings.workingDays.includes(weekdayOf(key));
    const start = Math.max(ws, ceil5(nowMs));
    if (working && we - start >= 15 * MIN) {
      days.push({ start, end: we, dayEnd });
    } else if (start < lastRedDue && dayEnd - start >= 15 * MIN && ws < lastRedDue) {
      // No normal hours left (evening, or a day off) but a Red task is still due: keep the day for it alone.
      days.push({ start, end: start, dayEnd });
    }
  }
  return days;
}

/**
 * Plans every unit. A Red unit that cannot be placed whole before its deadline gets the largest free
 * stretch left before it, reserved up front, so Yellow / Green / no-deadline work can never take that time.
 * `partial` receives the keys of units that only got part of their time.
 */
export function planUnits(o: PlanInput & { partial?: Set<string> }): Map<string, Interval> {
  const first = planCore(o);
  const missing = o.units.filter((u) => u.tier === 0 && !first.has(u.key));
  if (missing.length === 0) return first;

  const days = buildDays(o);
  const reserved: Interval[] = [];
  const partial = new Map<string, Interval>();
  for (const u of [...missing].sort((a, b) => a.orderIdx - b.orderIdx)) {
    const lim = limitFor(u, o.nowMs);
    const higher = o.units.filter((x) => x.orderIdx < u.orderIdx).map((x) => first.get(x.key)).filter((x): x is Interval => !!x);
    const obstacles = [...o.fixed, ...higher, ...reserved].map((f) => pad(f, PAD_FIXED_MIN));
    let best: Interval | null = null;
    for (const d of days) {
      for (const w of subtract([{ start: d.start, end: Math.min(d.dayEnd, lim) }], obstacles)) {
        const start = ceil5(w.start);
        const end = Math.min(w.end, start + u.durationMin * MIN);
        if (end - start >= 15 * MIN && (!best || end - start > best.end - best.start)) best = { start, end };
      }
    }
    if (best) {
      partial.set(u.key, best);
      reserved.push(best);
    }
  }
  if (partial.size === 0) return first;
  const rest = planCore({ ...o, units: o.units.filter((u) => !partial.has(u.key)), fixed: [...o.fixed, ...reserved] });
  for (const [k, v] of partial) {
    rest.set(k, v);
    o.partial?.add(k);
  }
  return rest;
}

function planCore(o: PlanInput): Map<string, Interval> {
  const { nowMs } = o;
  const out = new Map<string, Interval>();
  if (o.units.length === 0) return out;

  const days = buildDays(o);
  const hasRed = o.units.some((u) => u.tier === 0);
  const limitOf = (u: PlanUnit) => limitFor(u, nowMs);

  const load = days.map((d) => o.fixed.reduce((s, f) => s + overlap(f, d) / MIN, 0)); // booked minutes per day
  // Locked-in tasks take part in the same priority-ordered sweep as everyone else (focus intensity never
  // changes the queue). Once a locked task's turn comes it is placed as one unbroken chain.
  const lockedByTask = new Map<string, PlanUnit[]>();
  for (const u of o.units) if (u.pacing === "locked") lockedByTask.set(u.taskId, [...(lockedByTask.get(u.taskId) ?? []), u]);
  for (const chain of lockedByTask.values()) chain.sort((x, y) => x.seq - y.seq);

  // ── 2) Balanced + Chill, day by day ───────────────────────────────────────────────────
  const rest = o.units;
  // Day each part should not come before, so a task is spread rather than piled onto day one.
  const earliestDay = new Map<string, number>();
  const byTask = new Map<string, PlanUnit[]>();
  for (const u of rest) byTask.set(u.taskId, [...(byTask.get(u.taskId) ?? []), u].sort((a, b) => a.seq - b.seq));
  // Projected minutes per day, built up in priority order, so Green / no-deadline work can be
  // pushed to the lightest upcoming day instead of being crammed into Today.
  const proj = load.slice();
  const fill = (mins: number, cap: number) => {
    for (let i = 0; i < days.length && mins > 0; i++) {
      const take = Math.min(Math.max(0, cap - proj[i]), mins);
      proj[i] += take;
      mins -= take;
    }
  };
  const todayLow = new Set<string>();
  for (const parts of byTask.values()) {
    const first = parts[0];
    const isLocked = first.pacing === "locked";
    const totalMin = parts.reduce((sum, p) => sum + p.durationMin, 0);
    const cap = isLocked ? Infinity : DAY_CAP_MIN[first.pacing];

    if (first.tier >= 2) {
      // Green (5+ days) and no-deadline: spread over the upcoming days, lightest day first.
      const lim = limitOf(first);
      const items = isLocked ? [{ key: first.key, dur: totalMin }] : parts.map((p) => ({ key: p.key, dur: p.durationMin }));
      let prevDay = 0;
      for (const it of items) {
        let best = -1;
        for (let i = prevDay; i < days.length; i++) {
          if (days[i].start >= lim) break;
          if (days[i].end - days[i].start < 15 * MIN) continue; // no normal hours left that day
          if (!isLocked && proj[i] + it.dur > cap) continue;
          if (i === 0 && (todayLow.size >= TODAY_LOW_PRIORITY_MAX_TASKS && !todayLow.has(first.taskId) || proj[0] + it.dur > TODAY_LOW_PRIORITY_MAX_LOAD_MIN)) continue;
          if (best < 0 || proj[i] < proj[best]) best = i;
        }
        if (best < 0) best = Math.max(0, days.findIndex((d, i) => i >= prevDay && d.end - d.start >= 15 * MIN));
        earliestDay.set(it.key, best);
        proj[best] += it.dur;
        if (best === 0) todayLow.add(first.taskId);
        prevDay = best;
      }
      continue;
    }
    if (first.tier === 0 || isLocked) {
      fill(totalMin, cap === Infinity ? 480 : cap); // urgent: as early as possible, no spreading
      continue;
    }
    const shortest = Math.min(...parts.map((p) => p.durationMin));
    const lim = limitOf(first);
    const usable = days
      .map((d, i) => ({ d, i }))
      .filter(({ d, i }) => d.start < lim && DAY_CAP_MIN[first.pacing] - load[i] >= shortest)
      .map(({ i }) => i);
    const n = parts.length;
    const total = parts.reduce((s, p) => s + p.durationMin, 0);
    let before = 0;
    parts.forEach((p, idx) => {
      let wanted = 0;
      if (n > 1 && usable.length > 1) {
        if (first.pacing === "chill") {
          const spread = Math.min(usable.length, MAX_CHILL_SPREAD_DAYS);
          wanted = Math.floor((idx * spread) / n); // evenly over the days before the deadline
        } else {
          const spread = Math.min(usable.length, n); // front-loaded, ~total/days a day
          wanted = Math.min(spread - 1, Math.floor((before / total) * spread));
        }
      }
      earliestDay.set(p.key, usable[wanted] ?? usable[usable.length - 1] ?? 0);
      before += p.durationMin;
    });
    fill(totalMin, cap);
  }

  const prevKey = new Map<string, string>();
  for (const parts of byTask.values()) if (parts[0].pacing !== "locked") parts.forEach((p, i) => i > 0 && prevKey.set(p.key, parts[i - 1].key));
  const pending = [...rest].sort((a, b) => a.orderIdx - b.orderIdx || a.seq - b.seq);
  const done = new Set<string>();
  const placedRest: Interval[] = [];

  /**
   * One sweep over the days. With `capped`, a day stops at its load cap and a task's parts keep to
   * their spread-out days. The second sweep (capped = false) only runs for what still has no slot:
   * a deadline beats the daily cap, so those units use any free time left before their deadline.
   */
  const sweep = (capped: boolean) => {
    for (let d = 0; d < days.length && done.size < pending.length; d++) {
      const obstacles = [...o.fixed, ...placedRest].map((f) => pad(f, PAD_FIXED_MIN));
      const blocking = capped ? obstacles.slice(0, o.fixed.length) : obstacles;
      const windows = subtract([{ start: days[d].start, end: days[d].end }], blocking).filter((w) => w.end - w.start >= 15 * MIN);
      // Red units may also use the evening, up to their real deadline.
      const redWindows = hasRed
        ? subtract([{ start: days[d].start, end: days[d].dayEnd }], blocking).filter((w) => w.end - w.start >= 15 * MIN)
        : windows;
      let cursor = 0;
      let cum = 0;
      for (;;) {
        let placed = false;
        for (const u of pending) {
          if (done.has(u.key)) continue;
          if ((capped || u.tier >= 2) && (earliestDay.get(u.key) ?? 0) > d) continue;
          const usable = u.tier === 0 ? redWindows : windows;
          if (u.pacing === "locked") {
            const chain = lockedByTask.get(u.taskId)!;
            if (chain[0] !== u) continue; // placed together with its first part
            const need = chain.reduce((sum, c) => sum + c.durationMin, 0) + (chain.length - 1) * LOCKED_GAP_MIN;
            const cl = Math.min(...chain.map(limitOf));
            for (const w of usable) {
              let at = ceil5(Math.max(w.start, cursor));
              if (at + need * MIN > Math.min(w.end, cl)) continue;
              for (const c of chain) {
                const slot = { start: at, end: at + c.durationMin * MIN };
                out.set(c.key, slot);
                placedRest.push(slot);
                done.add(c.key);
                load[d] += c.durationMin;
                at = slot.end + LOCKED_GAP_MIN * MIN;
              }
              cursor = at;
              cum = 0;
              placed = true;
              break;
            }
            if (placed) break;
            continue;
          }
          const before = prevKey.get(u.key); // parts of one task go in order
          if (before && !done.has(before)) continue;
          if (capped && u.tier !== 0 && load[d] + u.durationMin > DAY_CAP_MIN[u.pacing]) continue; // a Red deadline beats the cap
          const lim = limitOf(u);
          for (const w of usable) {
            const start = ceil5(Math.max(w.start, cursor));
            const end = start + u.durationMin * MIN;
            if (end > Math.min(w.end, lim)) continue;
            out.set(u.key, { start, end });
            placedRest.push({ start, end });
            done.add(u.key);
            load[d] += u.durationMin;
            const r = restAfter(u.pacing, u.durationMin, cum);
            cum = r.cum;
            cursor = end + r.rest * MIN;
            placed = true;
            break;
          }
          if (placed) break;
        }
        if (!placed) break;
      }
    }
  };
  sweep(true);
  if (done.size < pending.length) sweep(false);
  return out;
}
