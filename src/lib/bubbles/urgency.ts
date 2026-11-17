import type { Task } from "@/types";
import type { Hue } from "@/components/Orb";
import { hoursLeft } from "./weight";

/**
 * Colour by time left to the deadline (priority doesn't change it):
 *  plum   Overdue  – the deadline has passed
 *  🔴 red    Urgent   – 0 to 48 hours left
 *  🟡 yellow Warning  – more than 48 up to 120 hours (2–5 days)
 *  🟢 green  Safe     – more than 120 hours (5+ days)
 */
export function bubbleHue(task: Task, now: number): Hue {
  const hours = hoursLeft(task, now);
  if (hours < 0) return "overdue";
  if (hours <= 48) return "red";
  if (hours <= 120) return "yellow";
  return "green";
}

/** Past its deadline and still not done. */
export const isOverdue = (task: Task, now: number): boolean =>
  task.status === "active" && Date.parse(task.deadline) < now;

export const HUE_META: Record<Hue, { label: string; hint: string }> = {
  overdue: { label: "Overdue", hint: "Past its deadline" },
  red: { label: "Urgent", hint: "Due in 2 days or less" },
  yellow: { label: "Warning", hint: "Due in 2–5 days" },
  green: { label: "Safe", hint: "Due in 5+ days" },
};
