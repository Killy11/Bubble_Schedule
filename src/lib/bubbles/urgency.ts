import type { Task } from "@/types";
import type { Hue } from "@/components/Orb";
import { effectivePriority } from "./effective";
import { hoursLeft } from "./weight";

/**
 * Traffic-light colour, red wins over yellow wins over green:
 *  🔴 Urgent  – high priority, or due within 12 h / overdue
 *  🟡 Warning – medium priority, or due within 48 h (this also covers the 12–24 h gap)
 *  🟢 Calm    – everything else: low priority (or unset) with more than 48 h to go
 */
export function bubbleHue(task: Task, now: number): Hue {
  const hours = hoursLeft(task, now);
  const p = effectivePriority(task);
  if (p === "high" || hours < 12) return "red";
  if (p === "medium" || hours < 48) return "yellow";
  return "green";
}

export const HUE_META: Record<Hue, { label: string; hint: string }> = {
  red: { label: "Urgent", hint: "High priority or due within 12 hours" },
  yellow: { label: "Warning", hint: "Medium priority or due within 48 hours" },
  green: { label: "Calm", hint: "Low priority, more than 48 hours away" },
};
