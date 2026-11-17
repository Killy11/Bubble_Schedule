"use client";

import { Check, Pencil, Pin, Sparkles } from "lucide-react";
import { formatDeadline, formatTime } from "@/lib/time";
import type { ScheduleBlock } from "@/types";
import { bubbleHue, HUE_META } from "@/lib/bubbles/urgency";
import type { Schedule, Task } from "@/types";

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
}: {
  schedule: Schedule | null;
  tasks: Task[];
  now: number;
  onComplete: (taskId: string) => void;
  onOpenBlock: (blockId: string) => void;
}) {
  const blocks = schedule?.blocks ?? [];
  const change = schedule?.lastChange;
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  // The plan spans several days: group by the day each block is scheduled (blocks are start-sorted).
  const groups = new Map<number, ScheduleBlock[]>();
  for (const b of blocks) {
    const key = dayStart(new Date(b.start).getTime());
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  const days = [...groups.entries()].sort((a, c) => a[0] - c[0]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
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

      {blocks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm text-muted">
          <p>Nothing scheduled for today yet.</p>
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
                      className={`glass flex items-start gap-3 rounded-2xl p-3 ${done ? "opacity-50" : ""}`}
                    >
                      <div
                        className={`min-w-0 flex-1 ${done ? "" : "cursor-pointer"}`}
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
          </section>
        ))
      )}
    </div>
  );
}
