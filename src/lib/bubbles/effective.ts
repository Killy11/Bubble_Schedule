import type { Priority, Task } from "@/types";

/** User value wins; the AI estimate only fills gaps. */
export const effectiveDuration = (t: Task): number | undefined =>
  t.durationMin ?? t.aiEstimate?.durationMin;
export const effectivePriority = (t: Task): Priority | undefined =>
  t.priority ?? t.aiEstimate?.priority;
