import type { Task } from "@/types";

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

/** Hours to the deadline; `Infinity` for a task without one. */
export const hoursLeft = (task: Task, nowMs: number): number =>
  task.deadline ? (new Date(task.deadline).getTime() - nowMs) / 3_600_000 : Infinity;

/**
 * Radius multiplier as the deadline nears (1 → 1.4). Smooth through 24h / 12h / 6h / 2h / overdue,
 * and applied to every task.
 */
export function deadlineGrowth(hours: number): number {
  return ramp(hours, [[0, 1.4], [2, 1.3], [6, 1.2], [12, 1.1], [24, 1.05], [48, 1]]);
}

/** 0–1 urgency: 1 when due/overdue, fading to 0 a week out. */
export function urgency(hours: number): number {
  return ramp(hours, [[0, 1], [2, 0.85], [6, 0.65], [12, 0.45], [24, 0.25], [72, 0.08], [168, 0]]);
}

/** 0–1 weight from how soon the deadline is (higher = closer to the centre, scheduled first). */
export function taskWeight(task: Task, nowMs: number): number {
  return urgency(hoursLeft(task, nowMs));
}
