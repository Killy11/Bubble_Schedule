"use client";

import { CheckCircle2, AlertCircle, Check, Pencil, Pin, Sparkles } from "lucide-react";
import { useLang } from "@/context/LanguageProvider";
import { formatDeadline, formatTime } from "@/lib/time";
import { bubbleHue, HUE_META } from "@/lib/bubbles/urgency";
import { formatDuration } from "@/lib/subtasks";
import type { Hue } from "@/components/Orb";
import type { Schedule, ScheduleBlock, Subtask, Task } from "@/types";

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);

const TYPE_LABEL = { added: "Added", moved: "Moved", removed: "Removed", resized: "Resized" } as const;

/** One card on the timeline: a standalone task's block, or one step of a bigger task. */
type Entry =
  | { kind: "block"; key: string; start: number; end: number; block: ScheduleBlock; task: Task }
  | { kind: "part"; key: string; start: number; end: number; task: Task; sub: Subtask; step: number; steps: number };

export function SchedulePanel({
  schedule,
  tasks,
  now,
  completedCount,
  overdueCount,
  onOpenCompleted,
  onOpenOverdue,
  onComplete,
  onOpenTask,
  onOpenPart,
  onEditBlockTime,
  onToggleSubtask,
}: {
  schedule: Schedule | null;
  /** Live tasks only: active and not overdue. Completed and overdue ones are not on the timeline. */
  tasks: Task[];
  now: number;
  completedCount: number;
  overdueCount: number;
  onOpenCompleted: () => void;
  onOpenOverdue: () => void;
  onComplete: (taskId: string) => void;
  /** A standalone task's card was clicked: open its details. */
  onOpenTask: (taskId: string) => void;
  /** A step's card was clicked: open the step with its parent's context. */
  onOpenPart: (taskId: string, subId: string) => void;
  onEditBlockTime: (blockId: string) => void;
  onToggleSubtask: (task: Task, sub: Subtask) => void;
}) {
  const { t, lang } = useLang();
  const change = schedule?.lastChange;
  const byId = new Map(tasks.map((x) => [x.id, x]));

  const entries: Entry[] = [];
  for (const b of schedule?.blocks ?? []) {
    const task = byId.get(b.taskId);
    // Blocks of finished, overdue or deleted tasks are gone from the timeline; so is a task that has parts (its parts show instead).
    if (!task || task.subtasks?.length || b.status === "done") continue;
    entries.push({ kind: "block", key: b.id, start: Date.parse(b.start), end: Date.parse(b.end), block: b, task });
  }
  for (const task of tasks) {
    const subs = [...(task.subtasks ?? [])].sort((a, c) => (a.scheduledStart ?? "9").localeCompare(c.scheduledStart ?? "9"));
    subs.forEach((sub, i) => {
      if (sub.completed || !sub.scheduledStart || !sub.scheduledEnd) return;
      entries.push({
        kind: "part", key: `part_${sub.id}`, task, sub, step: i + 1, steps: subs.length,
        start: Date.parse(sub.scheduledStart), end: Date.parse(sub.scheduledEnd),
      });
    });
  }
  const visible = entries.filter((e) => e.kind === "block" || dayStart(e.start) >= dayStart(now)).sort((a, c) => a.start - c.start);

  const groups = new Map<number, Entry[]>();
  for (const e of visible) groups.set(dayStart(e.start), [...(groups.get(dayStart(e.start)) ?? []), e]);
  const days = [...groups.entries()].sort((a, c) => a[0] - c[0]);

  /** "Today", "Tomorrow", or "Nov 20" (device-local days). */
  const dayLabel = (dayMs: number) => {
    const diff = Math.round((dayMs - dayStart(now)) / 86_400_000);
    if (diff === 0) return t("Today");
    if (diff === 1) return t("Tomorrow");
    return new Date(dayMs).toLocaleDateString(lang, { weekday: "short", month: "short", day: "numeric" });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {/* Two compact summary blocks; each opens its list. */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onOpenCompleted}
          className="glass flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 text-left transition hover:brightness-125"
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 text-[rgb(var(--glow-a))]" /> {t("Completed")}
          </span>
          <span className="text-sm font-semibold tabular-nums">{completedCount}</span>
        </button>
        <button
          type="button"
          onClick={onOpenOverdue}
          className={`glass flex items-center justify-between gap-2 rounded-2xl px-3 py-2.5 text-left transition hover:brightness-125 ${
            overdueCount > 0 ? "border-red-500/40" : ""
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <AlertCircle className={`h-4 w-4 ${overdueCount > 0 ? "text-red-500" : "text-muted"}`} /> {t("Overdue")}
          </span>
          <span className={`text-sm font-semibold tabular-nums ${overdueCount > 0 ? "text-red-500" : ""}`}>{overdueCount}</span>
        </button>
      </div>

      {change && (
        <section className="glass rounded-2xl p-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium text-[rgb(var(--glow-a))]">
            <Sparkles className="h-3.5 w-3.5" /> {t("Latest AI changes")}
          </div>
          <p className="text-sm">
            {change.code === "replanned"
              ? t("Re-planned by earliest deadline.")
              : change.code === "replanned_unplaced"
                ? change.count === 1
                  ? t("Re-planned by deadline. 1 task can't fully fit before its deadline.")
                  : t("Re-planned by deadline. {n} tasks can't fully fit before their deadlines.", { n: change.count ?? 0 })
                : change.summary}
          </p>
          {change.changes.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-xs text-muted">
              {change.changes.map((c, i) => (
                <li key={i}>
                  <span className="font-medium text-foreground">{t(TYPE_LABEL[c.type])}</span> {c.title}
                  {c.to && ` → ${formatTime(c.to.start)}`}
                  {c.why && <span> · {t(c.why)}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {days.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-center text-sm text-muted">{t("Nothing scheduled")}</p>
      ) : (
        days.map(([day, list]) => (
          <section key={day}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{dayLabel(day)}</h3>
            <ol className="relative space-y-3 border-l border-line pl-5">
              {list.map((e) => (
                <Card
                  key={e.key}
                  entry={e}
                  now={now}
                  onOpen={() => (e.kind === "part" ? onOpenPart(e.task.id, e.sub.id) : onOpenTask(e.task.id))}
                  onEditTime={e.kind === "block" ? () => onEditBlockTime(e.block.id) : undefined}
                  onComplete={() => (e.kind === "part" ? onToggleSubtask(e.task, e.sub) : onComplete(e.task.id))}
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
  onOpen,
  onEditTime,
  onComplete,
}: {
  entry: Entry;
  now: number;
  onOpen: () => void;
  onEditTime?: () => void;
  onComplete: () => void;
}) {
  const { t, lang } = useLang();
  const current = e.start <= now && now < e.end;
  const hue: Hue = bubbleHue(e.task, now);
  const title = e.kind === "part" ? e.sub.title : e.block.title;
  const minutes = Math.round((e.end - e.start) / 60_000);
  const pinned = e.kind === "block" && e.block.isPinned;
  const subtitle =
    e.kind === "part"
      ? `${t("Step {a}/{b}", { a: e.step, b: e.steps })} · ${e.task.title}`
      : e.task.deadline
        ? `${t("Due")} ${formatDeadline(e.task.deadline, now, t, lang)}`
        : null;

  return (
    <li className={`relative hue-${hue}`}>
      <span
        className={`hue-dot absolute rounded-full ${current ? "-left-[27px] top-[14px] h-3.5 w-3.5" : "-left-[25px] top-4 h-2.5 w-2.5"}`}
      />
      <div className="glass flex items-start gap-3 rounded-2xl p-3" style={{ borderLeft: "3px solid rgb(var(--c) / 0.75)" }}>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`${title}, ${formatTime(new Date(e.start).toISOString())} – ${formatTime(new Date(e.end).toISOString())}`}
          className="min-w-0 flex-1 text-left"
        >
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>
              {formatTime(new Date(e.start).toISOString())} – {formatTime(new Date(e.end).toISOString())} · {formatDuration(minutes, t)}
            </span>
            {pinned && <Pin aria-label={t("Pinned")} className="h-3 w-3 text-foreground" />}
            <span className="hue-badge">{t(HUE_META[hue].label)}</span>
          </p>
          <p title={title} className="line-clamp-2 break-words text-sm font-medium">{title}</p>
          {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
        </button>

        <span className="flex shrink-0 items-center gap-1">
          {onEditTime && (
            <button
              type="button"
              onClick={onEditTime}
              aria-label={t("Edit time")}
              title={t("Edit time")}
              className="rounded-full p-1.5 text-muted transition hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onComplete}
            aria-label={`${t("Complete")}: ${title}`}
            className="rounded-full border border-line p-1.5 text-muted transition hover:border-[rgb(var(--glow-a))] hover:text-[rgb(var(--glow-a))]"
          >
            <Check className="h-4 w-4" />
          </button>
        </span>
      </div>
    </li>
  );
}
