import type { Task } from "@/types";
import { effectiveDuration, effectivePriority } from "./effective";
import { deadlineGrowth, hoursLeft } from "./weight";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const fromMinutes = (min: number) => 44 + 11 * Math.sqrt(min);

/** Minutes of work still to do: max(15, (duration || 60) − logged). */
export function remainingMinutes(task: Task): number {
  return Math.max(15, (effectiveDuration(task) || 60) - (task.loggedMinutes ?? 0));
}

/**
 * Bubble diameter in px.
 *  base   = f(remaining minutes), so the orb shrinks as time is logged
 *  × growth as the deadline nears (any priority)
 *  × small priority nudge only when no duration is known at all
 *  × `base`: responsive factor (e.g. 0.78 on phones) applied to every bubble
 */
export function bubbleDiameter(task: Task, nowMs: number, base = 1): number {
  let d = fromMinutes(remainingMinutes(task));
  if (!effectiveDuration(task)) {
    const p = effectivePriority(task);
    d *= p === "high" ? 1.15 : p === "low" ? 0.88 : 1;
  }
  d *= deadlineGrowth(hoursLeft(task, nowMs));
  return Math.round(clamp(d, 70, 240) * base);
}
