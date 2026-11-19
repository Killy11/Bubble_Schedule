"use client";

import { useState } from "react";
import { CheckCircle2, AlertCircle, Check, Minus, Pause, Pencil, Pin, Play, Plus, Sparkles } from "lucide-react";
import { useSecondTick } from "@/hooks/useSecondTick";
import { formatClock, remainingMinutes, remainingMs, STEP_MIN } from "@/lib/remaining";
import { useLang } from "@/context/LanguageProvider";
import { formatDeadline, formatTime } from "@/lib/time";
import { bubbleHue, HUE_META } from "@/lib/bubbles/urgency";
import { formatDuration } from "@/lib/subtasks";
import type { Hue } from "@/components/Orb";
import type { LastAiAction, Schedule, ScheduleBlock, Subtask, Task } from "@/types";

const dayStart = (t: number) => new Date(t).setHours(0, 0, 0, 0);


/** One card on the timeline: a standalone task's block, or one step of a bigger task. */
type Entry =
  | { kind: "block"; key: string; start: number; end: number; block: ScheduleBlock; task: Task }
  | { kind: "part"; key: string; start: number; end: number; task: Task; sub: Subtask; step: number; steps: number };

export function SchedulePanel({
  schedule,
  lastAction,
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
  onAdjust,
  onToggleTimer,
}: {
  schedule: Schedule | null;
  /** The latest thing the user asked the AI to do (one short line). */
  lastAction?: LastAiAction;
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
  /** Add / take away planned time in 15-minute steps, without opening the editor. */
  onAdjust: (task: Task, deltaMin: number) => void;
  onToggleTimer: (task: Task) => void;
}) {
  const { t, lang } = useLang();
  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit", hour12: false });
  /** One short line, e.g. "Moved: Gym → 17:00–19:00" or "Added: Economics homework". */
  const actionLine = (a: LastAiAction) => {
    const label = { added: "Added", moved: "Moved", updated: "Updated", completed: "Completed", deleted: "Deleted" }[a.type];
    const what = a.type === "added" && (a.count ?? 1) > 1 ? `${a.title} +${(a.count ?? 1) - 1}` : a.title;
    const when = a.start && a.end ? ` → ${hhmm(a.start)}–${hhmm(a.end)}` : a.start ? ` → ${hhmm(a.start)}` : "";
    return `${a.step && (a.type === "deleted" || a.type === "completed") ? `${t(label)} ${t("step")}` : t(label)}: ${what}${when}`;
  };
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
    <div data-tour="schedule-view" className="flex h-full flex-col gap-4 overflow-y-auto overscroll-contain p-4">
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

      {lastAction && (
        <section className="glass flex items-center gap-2 rounded-2xl px-3 py-2.5">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--glow-a))]" />
          <p className="min-w-0 truncate text-sm" title={t("Latest AI changes")}>{actionLine(lastAction)}</p>
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
                  onEditTime={() => onEditBlockTime(e.kind === "part" ? `part_${e.sub.id}` : e.block.id)}
                  onComplete={() => (e.kind === "part" ? onToggleSubtask(e.task, e.sub) : onComplete(e.task.id))}
                  onAdjust={(d) => onAdjust(e.task, d)}
                  onToggleTimer={() => onToggleTimer(e.task)}
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
  onAdjust,
  onToggleTimer,
}: {
  entry: Entry;
  now: number;
  onOpen: () => void;
  onEditTime?: () => void;
  onComplete: () => void;
  onAdjust: (deltaMin: number) => void;
  onToggleTimer: () => void;
}) {
  const { t, lang } = useLang();
  const [timeOpen, setTimeOpen] = useState(false); // the inline −15m / +15m / ▶ controls
  const running = !!e.task.startedAt;
  const tick = useSecondTick(running);
  const hasParts = !!e.task.subtasks?.length;
  const leftLabel = running ? formatClock(remainingMs(e.task, tick)) : formatDuration(remainingMinutes(e.task), t);
  const current = e.start <= now && now < e.end;
  const hue: Hue = bubbleHue(e.task, now);
  const title = e.kind === "part" ? e.sub.title : e.block.title;
  const minutes = Math.round((e.end - e.start) / 60_000);
  const pinned = e.kind === "block" && e.block.isPinned;
  // Every card shows the deadline; for a step, its position is a compact tag ("2/4") instead of replacing it.
  const stepTag = e.kind === "part" ? `${e.step}/${e.steps}` : null;
  const subtitle = [
    e.kind === "part" ? e.task.title : null,
    e.task.deadline ? `${t("Due")} ${formatDeadline(e.task.deadline, now, t, lang)}` : null,
  ].filter(Boolean).join(" · ") || null;

  return (
    <li className={`relative hue-${hue}`}>
      <span
        className={`hue-dot absolute rounded-full ${current ? "-left-[27px] top-[14px] h-3.5 w-3.5" : "-left-[25px] top-4 h-2.5 w-2.5"}`}
      />
      <div className="glass flex items-start gap-2 rounded-2xl p-2.5" style={{ borderLeft: "3px solid rgb(var(--c) / 0.75)" }}>
        {/* direct complete: the circle on the left */}
        <button
          type="button"
          onClick={onComplete}
          aria-label={`${t("Complete")}: ${title}`}
          title={t("Complete")}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-muted transition hover:border-[rgb(var(--c))] hover:bg-[rgb(var(--c)/0.12)] hover:text-[rgb(var(--c))]"
        >
          <Check className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${title}, ${formatTime(new Date(e.start).toISOString())} – ${formatTime(new Date(e.end).toISOString())}`}
            className="block w-full min-w-0 text-left"
          >
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span>
                {formatTime(new Date(e.start).toISOString())} – {formatTime(new Date(e.end).toISOString())}
              </span>
              {pinned && <Pin aria-label={t("Pinned")} className="h-3 w-3 text-foreground" />}
              {stepTag && <span title={t("Step {a}/{b}", { a: e.kind === "part" ? e.step : 0, b: e.kind === "part" ? e.steps : 0 })} className="glass rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums text-foreground">{stepTag}</span>}
              <span className="hue-badge">{t(HUE_META[hue].label)}</span>
            </p>
            <p title={title} className="line-clamp-2 break-words text-sm font-medium">{title}</p>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </button>
          {/* time left: tap it for quick adjust and the countdown, no editor needed */}
          {e.kind === "part" || hasParts ? (
            <p className="mt-1 text-xs text-muted tabular-nums">{formatDuration(minutes, t)}</p>
          ) : (
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => setTimeOpen((v) => !v)}
                aria-expanded={timeOpen}
                className={`rounded-full border px-2.5 py-0.5 text-xs tabular-nums transition hover:text-foreground ${
                  running ? "border-[rgb(var(--c)/0.6)] text-foreground" : "border-line text-muted"
                }`}
              >
                {running ? "⏱ " : ""}{t("{d} left", { d: leftLabel })}
              </button>
              {timeOpen && (
                <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle">
                  <button type="button" onClick={() => onAdjust(-STEP_MIN)} aria-label={t("{n}m", { n: `−${STEP_MIN}` })}
                    className="flex h-7 items-center rounded-full border border-line px-2 text-xs transition hover:bg-foreground/10">
                    <Minus className="h-3 w-3" />{STEP_MIN}
                  </button>
                  <button type="button" onClick={() => onAdjust(STEP_MIN)} aria-label={t("{n}m", { n: `+${STEP_MIN}` })}
                    className="flex h-7 items-center rounded-full border border-line px-2 text-xs transition hover:bg-foreground/10">
                    <Plus className="h-3 w-3" />{STEP_MIN}
                  </button>
                  <button type="button" onClick={onToggleTimer} aria-label={running ? t("Pause") : t("Start timer")} aria-pressed={running}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-line transition hover:bg-foreground/10">
                    {running ? <Pause className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                  </button>
                </span>
              )}
            </div>
          )}
        </div>

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
        </span>
      </div>
    </li>
  );
}
