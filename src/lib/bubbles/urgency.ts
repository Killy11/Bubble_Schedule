import type { Task } from "@/types";
import type { Hue } from "@/components/Orb";
import { hoursLeft } from "./weight";

/**
 * Colour by time left to the deadline, nothing else:
 *  🔴 red    – 24 hours or less (under a day)
 *  🟡 yellow – more than 24 up to 120 hours (1–5 days)
 *  🟢 green  – more than 120 hours (5+ days), or no deadline at all
 * Tasks past their deadline leave the canvas (they live in Overdue), so they never get a colour of their own.
 */
export function bubbleHue(task: Task, now: number): Hue {
  const hours = hoursLeft(task, now); // Infinity without a deadline
  if (hours <= 24) return "red";
  if (hours <= 120) return "yellow";
  return "green";
}

/** Past its deadline and still not done. A task without a deadline is never overdue. */
export const isOverdue = (task: Task, now: number): boolean =>
  task.status === "active" && !!task.deadline && Date.parse(task.deadline) < now;

export const HUE_META: Record<Hue, { label: string; hint: string }> = {
  red: { label: "Urgent", hint: "Less than 1 day left" },
  yellow: { label: "Warning", hint: "1–5 days left" },
  green: { label: "Safe", hint: "5+ days or no deadline" },
};
