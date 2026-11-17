"use client";

import { useState } from "react";
import { Archive, Check, ListTree, Pencil, Pin, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { formatDeadline, formatTime } from "@/lib/time";
import type { ScheduleBlock } from "@/types";
import { bubbleHue, HUE_META } from "@/lib/bubbles/urgency";
import type { Schedule, Subtask, Task } from "@/types";
import { formatDuration } from "@/lib/subtasks";

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** "Today", "Tomorrow", or "Nov 20" (device-local days). */
function dayLabel(dayMs: number, now: number): string {
  const diff = Math.round((dayMs - dayStart(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return new Date(dayMs).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const TYPE_LABEL = {
  added: "Added",
  moved: "Moved",
  removed: "Removed",
  resized: "Resized",
} as const;

export function SchedulePanel({
  schedule,
  tasks,
  now,
  onComplete,
  onOpenBlock,
  onOpenTask,
  onToggleSubtask,
  allTasks,
  onRestoreTask,
  onDeleteTask,
  onOpenCompleted,
}: {
  schedule: Schedule | null;
  tasks: Task[];
  now: number;
  onComplete: (taskId: string) => void;
  onOpenBlock: (blockId: string) => void;
  onOpenTask: (taskId: string) => void;
  onToggleSubtask: (task: Task, sub: Subtask) => void;
  /** Every task (any status), so finished blocks can offer Restore. */
  allTasks: Task[];
  onRestoreTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onOpenCompleted: () => void;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  // A task split into parts is shown ONLY through its parts: its single big block (from an older plan)
  // would overlap them, so it is never rendered.
  const everyTask = new Map(allTasks.map((t) => [t.id, t]));
  const allBlocks = (schedule?.blocks ?? []).filter((b) => !everyTask.get(b.taskId)?.subtasks?.length);
  const doneCount = allBlocks.filter((b) => b.status === "done").length;
  // Finished blocks stay out of the timeline unless asked for.
  const blocks = showCompleted ? allBlocks : allBlocks.filter((b) => b.status !== "done");
  const change = schedule?.lastChange;
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // The plan spans several days: group by the day each block is scheduled (blocks are start-sorted).
  const groups = new Map<number, ScheduleBlock[]>();
  for (const b of blocks) {
    const key = dayStart(new Date(b.start).getTime());
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  // Upcoming parts of big tasks live on the task, not in the day plan: show them on their days too.
  const sessionsByDay = new Map<number, Array<{ task: Task; sub: Subtask }>>();
  for (const task of tasks) {
    for (const sub of task.subtasks ?? []) {
      if (sub.completed || !sub.scheduledStart || !sub.scheduledEnd) continue;
      const day = dayStart(Date.parse(sub.scheduledStart));
      if (day < dayStart(now)) continue;
      sessionsByDay.set(day, [...(sessionsByDay.get(day) ?? []), { task, sub }]);
    }
  }
  for (const list of sessionsByDay.values()) list.sort((a, c) => a.sub.scheduledStart!.localeCompare(c.sub.scheduledStart!));
  const days = [...new Set([...groups.keys(), ...sessionsByDay.keys()])]
    .sort((a, c) => a - c)
    .map((day) => [day, groups.get(day) ?? []] as const);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        {doneCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            aria-pressed={showCompleted}
            className={`rounded-full px-3 py-1.5 text-xs transition ${
              showCompleted ? "bg-foreground text-background" : "glass text-muted hover:text-foreground"
            }`}
          >
            {showCompleted ? "Hide" : "Show"} completed ({doneCount})
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onOpenCompleted}
          className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-foreground"
        >
          <Archive className="h-3.5 w-3.5" /> Completed
        </button>
      </div>
      {change && (
        <section className="glass rounded-2xl p-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-[rgb(var(--glow-a))]">
            <Sparkles className="h-3.5 w-3.5" /> Latest AI changes
          </div>
          <p className="text-sm">{change.summary}</p>
          {change.changes.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-xs text-muted">
              {change.changes.map((c, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">
                    {TYPE_LABEL[c.type]}
                  </span>{" "}
                  {c.title}
                  {c.to && ` → ${formatTime(c.to.start)}`}
                  {c.why && <span> · {c.why}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {days.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted">
          <p>{doneCount > 0 ? "Everything scheduled is done." : "Nothing scheduled for today yet."}</p>
          <p>
            Add some bubbles, then hit{" "}
            <span className="text-foreground">Auto-schedule</span>.
          </p>
        </div>
      ) : (
        days.map(([day, dayBlocks]) => (
          <section key={day}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {dayLabel(day, now)}
            </h3>
            <ol className="relative space-y-3 border-l border-line pl-5">
              {dayBlocks.map((b) => {
                const done = b.status === "done";
                const current =
                  !done &&
                  new Date(b.start).getTime() <= now &&
                  now < new Date(b.end).getTime();
                const task = taskById.get(b.taskId);
                const hue = task && !done ? bubbleHue(task, now) : null; // same colour as the bubble
                return (
                  <li
                    key={b.id}
                    className={`relative ${hue ? `hue-${hue}` : ""}`}
                  >
                    <span
                      className={`absolute -left-[25px] top-4 rounded-full ${
                        hue
                          ? `hue-dot ${current ? "h-3.5 w-3.5 -left-[27px] top-[14px]" : "h-2.5 w-2.5"}`
                          : "h-2.5 w-2.5 bg-muted/50"
                      }`}
                    />
                    <div
                      className="glass flex items-start gap-3 rounded-2xl p-3"
                    >
                      <div
                        className={`min-w-0 flex-1 ${done ? "opacity-50" : "cursor-pointer"}`}
                        {...(done
                          ? {}
                          : {
                              role: "button",
                              tabIndex: 0,
                              "aria-label": `Edit time of ${b.title}`,
                              onClick: () => onOpenBlock(b.id),
                              onKeyDown: (ev: React.KeyboardEvent) => {
                                if (ev.key === "Enter" || ev.key === " ") {
                                  ev.preventDefault();
                                  onOpenBlock(b.id);
                                }
                              },
                            })}
                      >
                        <p className="flex items-center gap-2 text-xs text-muted">
                          {formatTime(b.start)} – {formatTime(b.end)}
                          {b.isPinned && !done && <Pin aria-label="Pinned" className="h-3 w-3 text-foreground" />}
                          {!done && <Pencil aria-hidden className="h-3 w-3 opacity-60" />}
                          {hue && (
                            <span className="hue-badge">
                              {HUE_META[hue].label}
                            </span>
                          )}
                          {task && !done && <span>· due {formatDeadline(task.deadline, now)}</span>}
                        </p>
                        <p
                          title={b.title}
                          className={`line-clamp-2 break-words text-sm font-medium ${done ? "line-through" : ""}`}
                        >
                          {b.title}
                        </p>
                        {b.reason && !done && (
                          <p className="mt-1 text-xs text-muted">{b.reason}</p>
                        )}
                      </div>
                      {done && (
                        <span className="flex shrink-0 gap-1">
                          {everyTask.has(b.taskId) && (
                            <button
                              type="button"
                              onClick={() => onRestoreTask(b.taskId)}
                              aria-label={`Restore ${b.title}`}
                              title="Restore"
                              className="rounded-full border border-line p-1.5 text-muted transition hover:border-[rgb(var(--glow-a))] hover:text-[rgb(var(--glow-a))]"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteTask(b.taskId)}
                            aria-label={`Delete ${b.title} permanently`}
                            title="Delete"
                            className="rounded-full border border-line p-1.5 text-muted transition hover:border-red-500 hover:text-red-500"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </span>
                      )}
                      {!done && (
                        <button
                          onClick={() => onComplete(b.taskId)}
                          aria-label={`Complete ${b.title}`}
                          className="rounded-full border border-line p-1.5 text-muted transition hover:border-[rgb(var(--glow-a))] hover:text-[rgb(var(--glow-a))]"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {(sessionsByDay.get(day) ?? []).length > 0 && (
              <ul className={`space-y-2 ${dayBlocks.length ? "mt-3" : ""}`} aria-label="Parts of bigger tasks">
                {sessionsByDay.get(day)!.map(({ task, sub }) => (
                  <li key={sub.id} className="glass flex items-start gap-3 rounded-2xl border-dashed p-3">
                    <button type="button" onClick={() => onOpenTask(task.id)} className="min-w-0 flex-1 text-left">
                      <p className="flex items-center gap-1.5 text-xs text-muted">
                        <ListTree aria-hidden className="h-3 w-3" />
                        {formatTime(sub.scheduledStart!)} – {formatTime(sub.scheduledEnd!)} · {formatDuration(sub.durationMinutes)}
                      </p>
                      <p className="line-clamp-2 break-words text-sm font-medium">{sub.title}</p>
                      <p className="truncate text-xs text-muted">Part of {task.title}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleSubtask(task, sub)}
                      aria-label={`Mark done: ${sub.title}`}
                      className="rounded-full border border-line p-1.5 text-muted transition hover:border-[rgb(var(--glow-a))] hover:text-[rgb(var(--glow-a))]"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))
      )}
    </div>
  );
}
