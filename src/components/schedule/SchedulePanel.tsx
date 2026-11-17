"use client";

import { useState } from "react";
import { Archive, CalendarClock, Check, Pencil, Pin, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { PacingSelector } from "@/components/PacingSelector";
import { formatDeadline, formatOverdue, formatTime } from "@/lib/time";
import { bubbleHue, HUE_META, isOverdue } from "@/lib/bubbles/urgency";
import { formatDuration } from "@/lib/subtasks";
import type { Hue } from "@/components/Orb";
import type { Pacing, Schedule, ScheduleBlock, Subtask, Task } from "@/types";

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

/** "Today", "Tomorrow", or "Nov 20" (device-local days). */
function dayLabel(dayMs: number, now: number): string {
  const diff = Math.round((dayMs - dayStart(now)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return new Date(dayMs).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

const TYPE_LABEL = { added: "Added", moved: "Moved", removed: "Removed", resized: "Resized" } as const;

/** One card on the timeline: a standalone task's block, or one step of a bigger task. */
type Entry =
  | { kind: "block"; key: string; start: number; end: number; block: ScheduleBlock; task?: Task }
  | { kind: "part"; key: string; start: number; end: number; task: Task; sub: Subtask; step: number; steps: number }
  /** A task whose deadline has passed. These live in the OVERDUE section, never in a day's slots. */
  | { kind: "overdue"; key: string; start: number; end: number; task: Task };

export function SchedulePanel({
  schedule,
  tasks,
  allTasks,
  now,
  pacing,
  onChangePacing,
  onComplete,
  onOpenTask,
  onOpenPart,
  onEditBlockTime,
  onReschedule,
  onRemoveTask,
  onToggleSubtask,
  onRestoreTask,
  onDeleteTask,
  onOpenCompleted,
}: {
  schedule: Schedule | null;
  /** Active tasks. */
  tasks: Task[];
  /** Every task (any status), so finished blocks can offer Restore. */
  allTasks: Task[];
  now: number;
  /** Pacing given to new tasks. */
  pacing: Pacing;
  onChangePacing: (p: Pacing) => void;
  onComplete: (taskId: string) => void;
  /** A standalone task's card was clicked: open its details. */
  onOpenTask: (taskId: string) => void;
  /** A step's card was clicked: open the step with its parent's context. */
  onOpenPart: (taskId: string, subId: string) => void;
  onEditBlockTime: (blockId: string) => void;
  /** Overdue card: pick a new deadline. */
  onReschedule: (taskId: string) => void;
  /** Overdue card: delete the task (the app shows an Undo toast). */
  onRemoveTask: (taskId: string) => void;
  onToggleSubtask: (task: Task, sub: Subtask) => void;
  onRestoreTask: (taskId: string) => void;
  onDeleteTask: (taskId: string) => void;
  onOpenCompleted: () => void;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const change = schedule?.lastChange;
  const everyTask = new Map(allTasks.map((t) => [t.id, t]));

  // Overdue tasks get their own section at the top, so they don't sit in (or clog) any day's slots.
  const overdue = tasks
    .filter((t) => isOverdue(t, now))
    .sort((a, c) => a.deadline.localeCompare(c.deadline))
    .map((task): Extract<Entry, { kind: "overdue" }> => ({ kind: "overdue", key: `overdue_${task.id}`, task, start: Date.parse(task.deadline), end: Date.parse(task.deadline) }));
  const late = new Set(overdue.map((e) => e.task.id));
  // A task split into steps shows ONLY through its steps; its single big block (from an older plan) is never drawn.
  const blocks = (schedule?.blocks ?? []).filter((b) => !everyTask.get(b.taskId)?.subtasks?.length && !late.has(b.taskId));
  const entries: Entry[] = blocks.map((b) => ({
    kind: "block", key: b.id, start: Date.parse(b.start), end: Date.parse(b.end), block: b, task: everyTask.get(b.taskId),
  }));
  for (const task of tasks) {
    if (late.has(task.id)) continue;
    const subs = [...(task.subtasks ?? [])].sort((a, c) => (a.scheduledStart ?? "9").localeCompare(c.scheduledStart ?? "9"));
    subs.forEach((sub, i) => {
      if (!sub.scheduledStart || !sub.scheduledEnd) return;
      entries.push({
        kind: "part", key: `part_${sub.id}`, task, sub, step: i + 1, steps: subs.length,
        start: Date.parse(sub.scheduledStart), end: Date.parse(sub.scheduledEnd),
      });
    });
  }
  const isDone = (e: Entry) => (e.kind === "block" ? e.block.status === "done" : e.kind === "part" ? e.sub.completed : false);
  const doneCount = entries.filter(isDone).length;
  const visible = (showCompleted ? entries : entries.filter((e) => !isDone(e)))
    .filter((e) => e.kind === "block" || dayStart(e.start) >= dayStart(now))
    .sort((a, c) => a.start - c.start);

  const groups = new Map<number, Entry[]>();
  for (const e of visible) groups.set(dayStart(e.start), [...(groups.get(dayStart(e.start)) ?? []), e]);
  const days = [...groups.entries()].sort((a, c) => a[0] - c[0]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="space-y-2">
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
        <div>
          <p className="mb-1 text-[11px] text-muted">Focus intensity for new tasks</p>
          <PacingSelector value={pacing} onChange={onChangePacing} compact />
        </div>
      </div>

      {overdue.length > 0 && (
        <section aria-label="Overdue" className="hue-overdue">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--c))]">
            <span className="hue-dot h-2 w-2 rounded-full" /> Overdue ({overdue.length})
          </h3>
          <ol className="relative space-y-3 border-l border-[rgb(var(--c)/0.5)] pl-5">
            {overdue.map((e) => (
              <Card
                key={e.key}
                entry={e}
                now={now}
                hasTask
                onOpen={() => onOpenTask(e.task.id)}
                onComplete={() => onComplete(e.task.id)}
                onReschedule={() => onReschedule(e.task.id)}
                onRemove={() => onRemoveTask(e.task.id)}
                onRestore={() => {}}
                onDelete={() => {}}
              />
            ))}
          </ol>
        </section>
      )}

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
                  <span className="font-medium text-foreground">{TYPE_LABEL[c.type]}</span> {c.title}
                  {c.to && ` → ${formatTime(c.to.start)}`}
                  {c.why && <span> · {c.why}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {days.length === 0 && overdue.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted">
          <p>{doneCount > 0 ? "Everything scheduled is done." : "Nothing scheduled yet."}</p>
          <p>
            Add some bubbles and they are planned for you, or hit <span className="text-foreground">Auto-schedule</span>.
          </p>
        </div>
      ) : (
        days.map(([day, list]) => (
          <section key={day}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{dayLabel(day, now)}</h3>
            <ol className="relative space-y-3 border-l border-line pl-5">
              {list.map((e) => (
                <Card
                  key={e.key}
                  entry={e}
                  now={now}
                  hasTask={e.kind === "block" ? everyTask.has(e.block.taskId) : true}
                  onOpen={() => (e.kind === "part" ? onOpenPart(e.task.id, e.sub.id) : e.kind === "block" ? onOpenTask(e.block.taskId) : onOpenTask(e.task.id))}
                  onEditTime={e.kind === "block" ? () => onEditBlockTime(e.block.id) : undefined}
                  onComplete={() => (e.kind === "part" ? onToggleSubtask(e.task, e.sub) : e.kind === "block" ? onComplete(e.block.taskId) : onComplete(e.task.id))}
                  onRestore={() => e.kind === "block" && onRestoreTask(e.block.taskId)}
                  onDelete={() => e.kind === "block" && onDeleteTask(e.block.taskId)}
                />
              ))}
            </ol>
          </section>
        ))
      )}
    </div>
  );
}

/** The single card design used for every timeline item. Steps take their parent bubble's colour. */
function Card({
  entry: e,
  now,
  hasTask,
  onOpen,
  onEditTime,
  onReschedule,
  onRemove,
  onComplete,
  onRestore,
  onDelete,
}: {
  entry: Entry;
  now: number;
  hasTask: boolean;
  onOpen: () => void;
  onEditTime?: () => void;
  onReschedule?: () => void;
  onRemove?: () => void;
  onComplete: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const done = e.kind === "block" ? e.block.status === "done" : e.kind === "part" ? e.sub.completed : false;
  const current = !done && e.start <= now && now < e.end;
  const task = e.task;
  const hue: Hue | null = task && !done ? bubbleHue(task, now) : null;
  const title = e.kind === "part" ? e.sub.title : e.kind === "block" ? e.block.title : e.task.title;
  const isLate = e.kind === "overdue";
  const left = e.kind === "overdue" ? (e.task.subtasks ?? []).filter((s) => !s.completed).length : 0;
  const minutes = Math.round((e.end - e.start) / 60_000);
  const pinned = e.kind === "block" && e.block.isPinned && !done;
  const subtitle =
    e.kind === "part"
      ? `Step ${e.step}/${e.steps} · ${e.task.title}`
      : e.kind === "overdue"
        ? left > 0 ? `${left} step${left > 1 ? "s" : ""} left` : null
        : task && !done
        ? `Due ${formatDeadline(task.deadline, now)}`
        : null;

  return (
    <li className={`relative ${hue ? `hue-${hue}` : ""}`}>
      <span
        className={`absolute -left-[25px] top-4 rounded-full ${
          hue ? `hue-dot ${current ? "h-3.5 w-3.5 -left-[27px] top-[14px]" : "h-2.5 w-2.5"}` : "h-2.5 w-2.5 bg-muted/50"
        }`}
      />
      <div
        className="glass flex items-start gap-3 rounded-2xl p-3"
        style={hue ? { borderLeft: "3px solid rgb(var(--c) / 0.75)" } : undefined}
      >
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${title}, ${formatTime(new Date(e.start).toISOString())} to ${formatTime(new Date(e.end).toISOString())}. Show details`}
          className={`min-w-0 flex-1 text-left ${done ? "opacity-50" : ""}`}
        >
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {e.kind === "overdue" ? (
              <span>Was due {new Date(e.start).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            ) : (
              <span>
                {formatTime(new Date(e.start).toISOString())} – {formatTime(new Date(e.end).toISOString())} · {formatDuration(minutes)}
              </span>
            )}
            {pinned && <Pin aria-label="Pinned" className="h-3 w-3 text-foreground" />}
            {hue && <span className="hue-badge">{e.kind === "overdue" ? formatOverdue(e.task.deadline, now) : HUE_META[hue].label}</span>}
          </p>
          <p title={title} className={`line-clamp-2 break-words text-sm font-medium ${done ? "line-through" : ""}`}>
            {title}
          </p>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          {e.kind === "block" && e.block.reason && !done && <p className="mt-1 text-xs text-muted">{e.block.reason}</p>}
        </button>

        <span className="flex shrink-0 items-center gap-1">
          {isLate && (
            <>
              <button
                type="button"
                onClick={onReschedule}
                className="flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1.5 text-xs font-medium text-background transition hover:opacity-90"
              >
                <CalendarClock className="h-3.5 w-3.5" /> Reschedule
              </button>
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Delete ${title}`}
                title="Delete"
                className="rounded-full border border-line p-1.5 text-muted transition hover:border-red-500 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          {onEditTime && !done && (
            <button
              type="button"
              onClick={onEditTime}
              aria-label={`Edit the time of ${title}`}
              title="Edit time"
              className="rounded-full p-1.5 text-muted transition hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {done && e.kind === "block" && (
            <>
              {hasTask && (
                <button
                  type="button"
                  onClick={onRestore}
                  aria-label={`Restore ${title}`}
                  title="Restore"
                  className="rounded-full border border-line p-1.5 text-muted transition hover:border-[rgb(var(--glow-a))] hover:text-[rgb(var(--glow-a))]"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onDelete}
                aria-label={`Delete ${title} permanently`}
                title="Delete"
                className="rounded-full border border-line p-1.5 text-muted transition hover:border-red-500 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          {!done && (
            <button
              type="button"
              onClick={onComplete}
              aria-label={`Complete ${title}`}
              className="rounded-full border border-line p-1.5 text-muted transition hover:border-[rgb(var(--glow-a))] hover:text-[rgb(var(--glow-a))]"
            >
              <Check className="h-4 w-4" />
            </button>
          )}
        </span>
      </div>
    </li>
  );
}
