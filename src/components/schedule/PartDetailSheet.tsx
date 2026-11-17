"use client";

import { Check, Circle, Clock, Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { bubbleHue, HUE_META } from "@/lib/bubbles/urgency";
import { effectivePriority } from "@/lib/bubbles/effective";
import { PACING_META, pacingOf } from "@/lib/pacing";
import { formatDuration, formatWindow, subtaskProgress } from "@/lib/subtasks";
import { formatDeadline } from "@/lib/time";
import type { Subtask, Task } from "@/types";

/** One scheduled step, with the context of the bigger task it belongs to. */
export function PartDetailSheet({
  task,
  sub,
  now,
  onClose,
  onToggle,
  onEditParent,
}: {
  task: Task | null;
  sub: Subtask | null;
  now: number;
  onClose: () => void;
  onToggle: (t: Task, s: Subtask) => Promise<void>;
  onEditParent: (t: Task) => void;
}) {
  const open = !!task && !!sub;
  const [busy, setBusy] = useState(false);
  const hue = task ? bubbleHue(task, now) : "green";
  const progress = task ? subtaskProgress(task) : null;
  const priority = task && effectivePriority(task);
  const siblings = task
    ? [...(task.subtasks ?? [])].sort((a, b) => (a.scheduledStart ?? "9").localeCompare(b.scheduledStart ?? "9"))
    : [];

  return (
    <Sheet open={open} onClose={onClose} title={sub?.title ?? ""}>
      {task && sub && (
        <div className={`space-y-5 hue-${hue}`}>
          <section className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted" />
              <span>{formatWindow(sub, now)}</span>
              <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{formatDuration(sub.durationMinutes)}</span>
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onToggle(task, sub);
                } finally {
                  setBusy(false);
                }
              }}
              className={`flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition hover:opacity-90 disabled:opacity-60 ${
                sub.completed ? "glass text-foreground" : "bg-foreground text-background"
              }`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {sub.completed ? "Mark as not done" : "Mark this step complete"}
            </button>
          </section>

          <section className="glass space-y-3 rounded-2xl p-4" aria-label="Parent task">
            <div>
              <p className="text-xs text-muted">Part of</p>
              <p className="break-words text-base font-semibold">{task.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="hue-badge"><span className="hue-dot h-2 w-2 rounded-full" /> {HUE_META[hue].label}</span>
                {priority && <span>{priority[0].toUpperCase() + priority.slice(1)} priority</span>}
                <span>· {PACING_META[pacingOf(task)].label}</span>
                <span>· due {formatDeadline(task.deadline, now)}</span>
              </p>
            </div>

            {progress && (
              <div>
                <p className="text-sm">{progress.done} of {progress.total} steps completed</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar"
                  aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(progress.done / progress.total) * 100}%`, background: "rgb(var(--c))" }} />
                </div>
              </div>
            )}

            <ol className="space-y-2">
              {siblings.map((s, i) => (
                <li key={s.id} className={`flex items-start gap-2 text-sm ${s.id === sub.id ? "font-medium" : ""}`}>
                  {s.completed ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--c))]" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                  <span className="min-w-0 flex-1">
                    <span className={`break-words ${s.completed ? "text-muted line-through" : ""}`}>
                      {i + 1}. {s.title}
                    </span>
                    <span className="block text-xs text-muted">{formatWindow(s, now)} · {formatDuration(s.durationMinutes)}</span>
                  </span>
                  {s.id === sub.id && <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px]">this step</span>}
                </li>
              ))}
            </ol>

            <button
              type="button"
              onClick={() => onEditParent(task)}
              className="glass flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm text-muted transition hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit the full task
            </button>
          </section>
        </div>
      )}
    </Sheet>
  );
}
