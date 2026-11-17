import type { Task } from "@/types";
import { effectivePriority } from "./effective";

/** Piecewise-linear interpolation over [x, y] anchors sorted by x; clamps outside the range. */
function ramp(x: number, pts: Array<[number, number]>): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    if (x <= x1) {
      const [x0, y0] = pts[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

export const hoursLeft = (task: Task, nowMs: number): number =>
  (new Date(task.deadline).getTime() - nowMs) / 3_600_000;

/**
 * Radius multiplier as the deadline nears (1 → 1.4). Smooth through 24h / 12h / 6h / 2h / overdue,
 * and applied to every priority, so even a Low task visibly grows.
 */
export function deadlineGrowth(hours: number): number {
  return ramp(hours, [[0, 1.4], [2, 1.3], [6, 1.2], [12, 1.1], [24, 1.05], [48, 1]]);
}

/** 0–1 urgency: 1 when due/overdue, fading to 0 a week out. */
export function urgency(hours: number): number {
  return ramp(hours, [[0, 1], [2, 0.85], [6, 0.65], [12, 0.45], [24, 0.25], [72, 0.08], [168, 0]]);
}

const PRIORITY_WEIGHT = { high: 1, medium: 0.6, low: 0.3 } as const;

/**
 * Combined urgency-priority weight in 0–1 (higher = closer to the centre, scheduled first).
 * Deadline pressure is weighted a little above priority, so a Low task that is overdue
 * outranks a High task due next week.
 */
export function taskWeight(task: Task, nowMs: number): number {
  const p = effectivePriority(task);
  const prio = p ? PRIORITY_WEIGHT[p] : 0.45;
  return 0.45 * prio + 0.55 * urgency(hoursLeft(task, nowMs));
}
