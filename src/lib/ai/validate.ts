import type { Task, UserSettings } from "@/types";
import { localNaiveToUtc, minutesOfDay, toLocalNaive } from "@/lib/time";
import { latestEndMs, planningDays } from "./horizon";
import type { AiRawResult } from "./schema";

export interface CheckedBlock {
  taskId: string;
  start: Date;
  end: Date;
  reason: string;
}
export interface Rejected {
  taskId: string;
  problem: string;
}

interface Ctx {
  tz: string;
  targetDate: string;
  now: Date;
  settings: UserSettings;
  /** Tasks the model was asked to place. */
  tasks: Task[];
  /** Locked blocks: immovable, nothing may overlap them. */
  busy?: Array<{ start: Date; end: Date }>;
  /** Required rest between blocks (and around locked ones), in minutes. */
  minBreakMin?: number;
  /** Reject blocks that break the rest rule (the first attempt; the retry only enforces no-overlap). */
  strictBreaks?: boolean;
  raw: AiRawResult;
}

/** Normalise lengths, then reject blocks that break the rules. Pure and deterministic. */
export function checkBlocks(c: Ctx): { ok: CheckedBlock[]; rejected: Rejected[] } {
  const byId = new Map(c.tasks.map((t) => [t.id, t]));
  const estimate = new Map(c.raw.taskEstimates.map((e) => [e.taskId, e.durationMin]));
  const days = planningDays(c.targetDate, c.settings.workingDays);
  const { start: ws, end: we } = c.settings.workingHours;
  const gap = c.strictBreaks ? (c.minBreakMin ?? 0) * 60_000 : 0;
  const rejected: Rejected[] = [];
  const candidates: CheckedBlock[] = [];
  const seen = new Set<string>();

  for (const b of c.raw.blocks) {
    const task = byId.get(b.taskId);
    const bad = (problem: string) => rejected.push({ taskId: b.taskId, problem });
    if (!task) { bad("unknown taskId"); continue; }
    if (seen.has(b.taskId)) { bad("more than one block for this task"); continue; }
    seen.add(b.taskId);

    const start = localNaiveToUtc(b.start, c.tz);
    let end = localNaiveToUtc(b.end, c.tz);
    if (!start || !end) { bad("start/end are not valid YYYY-MM-DDTHH:mm"); continue; }
    // Length: the user's duration is law; otherwise the AI's estimate; otherwise its own block.
    const total = task.durationMin ?? estimate.get(task.id);
    const logged = task.loggedMinutes ?? 0;
    const dur = total && total > 0 ? (logged > 0 ? Math.max(15, total - logged) : total) : undefined;
    if (dur) end = new Date(start.getTime() + dur * 60_000);
    if (end <= start) { bad("end must be after start"); continue; }

    const sNaive = toLocalNaive(start, c.tz);
    const eNaive = toLocalNaive(end, c.tz);
    const day = sNaive.slice(0, 10);
    if (day !== eNaive.slice(0, 10)) { bad("must start and end on the same day"); continue; }
    if (!days.includes(day)) { bad(`must be on one of the available days: ${days.join(", ")}`); continue; }
    if (minutesOfDay(sNaive) < minutesOfDay(ws) || minutesOfDay(eNaive) > minutesOfDay(we))
      { bad(`must be within working hours ${ws}–${we}`); continue; }
    if (start.getTime() < c.now.getTime() - 60_000)
      { bad("starts before the current time"); continue; }
    const mustEnd = latestEndMs(new Date(task.deadline).getTime(), c.now.getTime(), (end.getTime() - start.getTime()) / 60_000);
    if (end.getTime() > mustEnd)
      { bad(`must end by ${toLocalNaive(new Date(mustEnd), c.tz)} (deadline minus a safety margin)`); continue; }
    if ((c.busy ?? []).some((x) => start < x.end && end > x.start))
      { bad("overlaps a locked block"); continue; }
    if (gap > 0 && (c.busy ?? []).some((x) => start.getTime() < x.end.getTime() + gap && end.getTime() > x.start.getTime() - gap))
      { bad(`needs at least ${c.minBreakMin} minutes of rest before and after a locked block`); continue; }
    candidates.push({ taskId: b.taskId, start, end, reason: b.reason });
  }

  // Overlaps: keep the earlier block, reject the later one.
  candidates.sort((a, b) => a.start.getTime() - b.start.getTime());
  const ok: CheckedBlock[] = [];
  for (const b of candidates) {
    const prev = ok[ok.length - 1];
    if (prev && b.start < prev.end) {
      rejected.push({ taskId: b.taskId, problem: "overlaps another block" });
    } else if (prev && gap > 0 && b.start.getTime() < prev.end.getTime() + gap) {
      rejected.push({ taskId: b.taskId, problem: `needs at least ${c.minBreakMin} minutes of rest after the previous block` });
    } else ok.push(b);
  }
  return { ok, rejected };
}
