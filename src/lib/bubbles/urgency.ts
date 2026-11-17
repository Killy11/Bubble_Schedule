import type { Task } from "@/types";
import type { Hue } from "@/components/Orb";
import { hoursLeft } from "./weight";

/**
 * Colour by time left to the deadline (priority doesn't change it):
 *  plum   Overdue  – the deadline has passed
 *  🔴 red    Urgent   – 0 to 24 hours left (under a day)
 *  🟡 yellow Warning  – more than 24 up to 120 hours (1–5 days)
 *  🟢 green  Safe     – more than 120 hours (5+ days)
 */
export function bubbleHue(task: Task, now: number): Hue {
  const hours = hoursLeft(task, now);
  if (hours < 0) return "overdue";
  if (hours <= 24) return "red";
  if (hours <= 120) return "yellow";
  return "green";
}

/** Past its deadline and still not done. */
export const isOverdue = (task: Task, now: number): boolean =>
  task.status === "active" && Date.parse(task.deadline) < now;

export const HUE_META: Record<Hue, { label: string; hint: string }> = {
  overdue: { label: "Overdue", hint: "Past its deadline" },
  red: { label: "Urgent", hint: "Less than 1 day left" },
  yellow: { label: "Warning", hint: "1–5 days left" },
  green: { label: "Safe", hint: "5+ days left" },
};
