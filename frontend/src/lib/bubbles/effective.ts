import type { Task } from "@/types";

/** The user's duration wins; the AI estimate only fills the gap. */
export const effectiveDuration = (t: Task): number | undefined =>
  t.durationMin ?? t.aiEstimate?.durationMin;
