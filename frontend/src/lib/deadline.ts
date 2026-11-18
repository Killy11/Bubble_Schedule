import type { Task } from "@/types";

/** Deadline as epoch ms; `Infinity` when the task has none (so it sorts last and is never overdue). */
export const deadlineMs = (task: Pick<Task, "deadline">): number =>
  task.deadline ? Date.parse(task.deadline) : Infinity;

export const hasDeadline = (task: Pick<Task, "deadline">): boolean => !!task.deadline;

/** Active and past its deadline. Tasks without a deadline never are. */
export const isOverdueTask = (task: Task, now: number): boolean =>
  task.status === "active" && deadlineMs(task) < now;

/** Active and not overdue: what the canvas and the timeline show. */
export const isLiveTask = (task: Task, now: number): boolean =>
  task.status === "active" && deadlineMs(task) >= now;
