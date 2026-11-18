"use client";

import { useState } from "react";
import { ArrowLeft, BellRing, Check, Clock, Flag, Loader2, Minus, Pause, Pencil, Play, Plus, Repeat, Sparkles, Trash2 } from "lucide-react";
import { useNotifications } from "@/context/NotificationProvider";
import { useSecondTick } from "@/hooks/useSecondTick";
import { formatClock, progressOf, remainingMinutes, remainingSeconds, sessionMinutes, sessionSeconds, spentMinutes, STEP_MIN } from "@/lib/remaining";
import { Sheet } from "@/components/Sheet";
import { RecurrencePicker } from "./RecurrencePicker";
import { formatDuration } from "@/lib/subtasks";
import { SubtaskList } from "./SubtaskList";
import { DeadlineField } from "@/components/DeadlineField";
import { useLang } from "@/context/LanguageProvider";
import { pacingOf } from "@/lib/pacing";
import { formatDeadline } from "@/lib/time";
import { effectiveDuration } from "@/lib/bubbles/effective";
import { DurationFields } from "@/components/DurationFields";
import { clampDuration, splitMinutes, totalMinutes } from "@/lib/duration";
import { bubbleHue, HUE_META } from "@/lib/bubbles/urgency";
import type { Pacing, Recurrence, Subtask, Task } from "@/types";

export interface TaskEdit {
  title: string;
  deadline: string | null; // ISO, or null = no deadline
  durationMin: number | null;
  pacing: Pacing;
  description?: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const field =
  "glass w-full rounded-2xl px-4 py-2.5 text-sm outline-none transition focus:border-[rgb(var(--glow-a))] placeholder:text-muted";


export function TaskDetailSheet({
  task,
  now,
  onClose,
  onComplete,
  onDelete,
  onStartTimer,
  onStopTimer,
  onConfirmTimer,
  onAdjust,
  onSetRecurrence,
  onEdit,
  onEditTime,
  splitting,
  onToggleSubtask,
  onSaveSubtasks,
  onSplit,
}: {
  task: Task | null;
  now: number;
  onClose: () => void;
  /** `actualMin` is the time the user says it really took (omitted: tracked time is used). */
  onComplete: (t: Task, actualMin?: number) => Promise<void>;
  onDelete: (t: Task) => Promise<void>;
  onStartTimer: (t: Task) => Promise<void>;
  /** Pause. */
  onStopTimer: (t: Task) => Promise<void>;
  /** Stop & confirm: credits the session's whole minutes (rounded down). Returns the minutes credited. */
  onConfirmTimer: (t: Task) => Promise<number>;
  /** Move the time left by whole minutes (±15). */
  onAdjust: (t: Task, deltaMin: number) => Promise<void>;
  onSetRecurrence: (t: Task, r: Recurrence | null) => Promise<void>;
  onEdit: (t: Task, patch: TaskEdit) => Promise<void>;
  /** Open the scheduled-time editor (when the task has a scheduled slot). */
  onEditTime?: (t: Task) => void;
  splitting: boolean;
  onToggleSubtask: (t: Task, sub: Subtask, checked: boolean) => Promise<void>;
  onSaveSubtasks: (t: Task, subs: Subtask[]) => Promise<void>;
  onSplit: (t: Task, parts?: number) => void;
}) {
  const hue = task ? bubbleHue(task, now) : "green";
  return (
    <Sheet open={!!task} onClose={onClose} title={task?.title ?? ""}>
      {/* keyed by task: every time a bubble is opened the modal starts on the Timer view */}
      {task && (
        <div className={`hue-${hue}`}>
          <Body key={task.id} {...{ task, now, onClose, onComplete, onDelete, onStartTimer, onStopTimer, onConfirmTimer, onAdjust, onSetRecurrence, onEdit, onEditTime, splitting, onToggleSubtask, onSaveSubtasks, onSplit }} />
        </div>
      )}
    </Sheet>
  );
}

type BodyProps = Omit<Parameters<typeof TaskDetailSheet>[0], "task"> & { task: Task };

function Body({
  task, now, onClose, onComplete, onDelete, onStartTimer, onStopTimer, onConfirmTimer, onAdjust, onSetRecurrence, onEdit, onEditTime,
  splitting, onToggleSubtask, onSaveSubtasks, onSplit,
}: BodyProps) {
  const { t, lang } = useLang();
  // Step 1 is the Timer & Quick Actions view; Step 2 (the full form) opens only from its Edit button.
  const [view, setView] = useState<"timer" | "edit">("timer");
  const [busy, setBusy] = useState(false);
  const [actual, setActual] = useState("");
  const hue = bubbleHue(task, now);
  const dur = effectiveDuration(task);
  const guessed = !task.durationMin && task.aiEstimate;
  const tracked = spentMinutes(task) + sessionMinutes(task, now);

  const run = async (fn: (t: Task) => Promise<void>) => {
    setBusy(true);
    onClose(); // close first so the bubble can pop
    try { await fn(task); } finally { setBusy(false); }
  };

  if (view === "edit") {
    return (
      <div className="space-y-5">
        <button type="button" onClick={() => setView("timer")}
          className="glass flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs text-muted transition hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("Back")}
        </button>
        <EditForm task={task} now={now} onCancel={() => setView("timer")}
          onSave={async (patch) => { await onEdit(task, patch); setView("timer"); }} />
        {onEditTime && (
          <button type="button" onClick={() => onEditTime(task)}
            className="glass flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-muted transition hover:text-foreground">
            <Clock className="h-4 w-4" /> {t("Edit time")}
          </button>
        )}

        <SubtaskList key={`parts-${task.id}`} task={task} now={now} splitting={splitting}
          onToggle={onToggleSubtask} onSave={onSaveSubtasks} onSplit={onSplit} />

        {task.deadline && (
          <section className="space-y-2">
            <p className="flex items-center gap-2 text-xs text-muted"><Repeat className="h-3.5 w-3.5" /> {t("Repeat")}</p>
            <RecurrencePicker value={task.recurrence ?? null} anchorDow={new Date(task.deadline).getDay()}
              onChange={(r) => void onSetRecurrence(task, r)} />
          </section>
        )}

        <label className="block text-xs text-muted">
          {t("How long did it take? (min)")}
          <input type="number" inputMode="numeric" min={1} max={1440} step={1} value={actual}
            onChange={(e) => setActual(e.target.value)}
            placeholder={tracked > 0 ? t("{n} tracked", { n: tracked }) : dur ? t("about {n}", { n: dur }) : "45"}
            className="glass mt-1 w-full rounded-full px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-[rgb(var(--glow-a))]" />
        </label>
        <div className="flex gap-3">
          <button disabled={busy} onClick={() => {
              const n = Number(actual);
              const value = actual && Number.isFinite(n) && n >= 1 ? Math.min(1440, Math.round(n)) : undefined;
              setActual("");
              void run((x) => onComplete(x, value));
            }}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
            <Check className="h-4 w-4" /> {t("Complete")}
          </button>
          <button disabled={busy} onClick={() => run(onDelete)} aria-label={t("Delete")}
            className="glass flex items-center justify-center rounded-full px-4 text-muted transition hover:text-red-500 disabled:opacity-60">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="hue-badge"><span className="hue-dot h-2 w-2 rounded-full" /> {t(HUE_META[hue].label)}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Clock className="h-3.5 w-3.5" />
            {task.deadline ? `${t("Due")} ${formatDeadline(task.deadline, now, t, lang)}` : t("No deadline")}
          </span>
        </div>
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
          <span className="flex items-center gap-1.5"><Flag className="h-3.5 w-3.5" />
            {dur ? t("Takes {d}", { d: formatDuration(dur, t) }) : t("Standard size")}{guessed ? ` (${t("AI estimate")})` : ""}</span>
          {task.aiEstimate?.reasoning && <span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" />{task.aiEstimate.reasoning}</span>}
        </p>
      </div>

      <ProgressTimer
        task={task}
        busy={busy}
        onComplete={() => void run((x) => onComplete(x))}
        onAdjust={onAdjust}
        onStart={onStartTimer}
        onPause={onStopTimer}
        onConfirm={onConfirmTimer}
      />

      <button type="button" onClick={() => setView("edit")}
        className="glass flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-foreground transition hover:brightness-125">
        <Pencil className="h-4 w-4" /> {t("Edit task")}
      </button>
    </div>
  );
}

/** Step 1: whole-minute summary, the live MM:SS timer, Start / Pause, Stop & confirm, ±15 min and Complete. */
function ProgressTimer({
  task, busy, onComplete, onAdjust, onStart, onPause, onConfirm,
}: {
  task: Task;
  busy: boolean;
  onComplete: () => void;
  onAdjust: (t: Task, deltaMin: number) => Promise<void>;
  onStart: (t: Task) => Promise<void>;
  onPause: (t: Task) => Promise<void>;
  onConfirm: (t: Task) => Promise<number>;
}) {
  const { t } = useLang();
  const { permission, enable, enabling } = useNotifications();
  const running = !!task.startedAt;
  const tick = useSecondTick(running); // one tick a second, only while the timer runs
  const session = sessionSeconds(task, tick);
  const left = remainingSeconds(task, tick);
  const hasSession = running || session >= 1;
  const timeUp = running && left <= 0 && remainingMinutes(task) > 0;
  const pct = Math.round(progressOf(task, tick) * 100);
  const [pending, setPending] = useState(false);
  const [credited, setCredited] = useState<number | null>(null);
  const act = async (fn: () => Promise<void>) => {
    setPending(true);
    try { await fn(); } catch { /* the dashboard shows its own error toast */ } finally { setPending(false); }
  };
  const small = "flex h-9 items-center justify-center gap-1.5 rounded-full border border-line px-3 text-xs transition hover:bg-foreground/10 disabled:opacity-50";

  return (
    <section className="glass space-y-3 rounded-2xl p-4">
      {timeUp && (
        <div role="alert" className="space-y-2 rounded-xl border border-[rgb(var(--c)/0.5)] bg-[rgb(var(--c)/0.1)] p-3">
          <p className="text-sm font-medium">⏰ {t("Time's up!")}</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={onComplete}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-60">
              <Check className="h-3.5 w-3.5" /> {t("Done")}
            </button>
            <button type="button" disabled={pending} onClick={() => act(() => onAdjust(task, STEP_MIN))}
              className="flex-1 rounded-full border border-line px-3 py-2 text-xs transition hover:bg-foreground/10 disabled:opacity-60">
              {t("{n}m", { n: `+${STEP_MIN}` })}
            </button>
          </div>
        </div>
      )}

      <p className="text-center text-xs text-muted">
        {t("Spent: {n} min", { n: spentMinutes(task) })} · {t("Left: {n} min", { n: remainingMinutes(task) })}
      </p>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-foreground/5 px-2 py-2">
          <p className="text-[11px] text-muted">{t("Elapsed")}</p>
          <p className="text-2xl font-semibold tabular-nums">{formatClock(session * 1000)}</p>
        </div>
        <div className="rounded-xl bg-foreground/5 px-2 py-2">
          <p className="text-[11px] text-muted">{t("Time left")}</p>
          <p className="text-2xl font-semibold tabular-nums">{formatClock(left * 1000)}</p>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: "rgb(var(--c))" }} />
      </div>

      <div className="flex gap-2">
        <button type="button" disabled={pending} onClick={() => { setCredited(null); void act(() => (running ? onPause(task) : onStart(task))); }}
          aria-pressed={running}
          className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-foreground/10 text-sm font-medium transition hover:bg-foreground/15 disabled:opacity-50">
          {running ? <><Pause className="h-4 w-4 fill-current" /> {t("Pause")}</> : <><Play className="h-4 w-4 fill-current" /> {t("Start timer")}</>}
        </button>
        <button type="button" disabled={pending || !hasSession}
          onClick={() => act(async () => setCredited(await onConfirm(task)))}
          aria-label={t("Stop & credit")} title={t("Stop & credit")}
          className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm transition hover:bg-foreground/10 disabled:opacity-40">
          <Check className="h-4 w-4" /> {t("Credit")}
        </button>
      </div>
      {credited !== null && (
        <p role="status" className="text-center text-xs text-muted">{t("Credited {n} min", { n: credited })}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <span className="flex gap-1.5">
          <button type="button" disabled={pending} onClick={() => act(() => onAdjust(task, -STEP_MIN))} className={small} aria-label={t("{n}m", { n: `−${STEP_MIN}` })}>
            <Minus className="h-3 w-3" />{STEP_MIN} {t("min")}
          </button>
          <button type="button" disabled={pending} onClick={() => act(() => onAdjust(task, STEP_MIN))} className={small} aria-label={t("{n}m", { n: `+${STEP_MIN}` })}>
            <Plus className="h-3 w-3" />{STEP_MIN} {t("min")}
          </button>
        </span>
      </div>

      <button type="button" disabled={busy} onClick={onComplete}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
        <Check className="h-4 w-4" /> {t("Complete")}
      </button>

      {permission === "default" && (
        <button type="button" disabled={enabling} onClick={() => void enable()}
          className="flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-foreground">
          <BellRing className="h-3.5 w-3.5" /> {t("🔔 Enable timer completion notifications")}
        </button>
      )}
    </section>
  );
}

function EditForm({
  task,
  now,
  onSave,
  onCancel,
}: {
  task: Task;
  now: number;
  onSave: (patch: TaskEdit) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLang();
  const [title, setTitle] = useState(task.title);
  const [deadline, setDeadline] = useState(task.deadline ? toLocalInput(task.deadline) : "");
  const [noDeadline, setNoDeadline] = useState(!task.deadline);
  const [notes, setNotes] = useState(task.description ?? "");
  const [hours, setHours] = useState(() => splitMinutes(task.durationMin).hours);
  const [mins, setMins] = useState(() => splitMinutes(task.durationMin).minutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const when = new Date(deadline);
    if (!title.trim()) return setError(t("Give your bubble a title."));
    if (!noDeadline && Number.isNaN(when.getTime())) return setError(t("Pick a deadline."));
    if (!noDeadline && when.getTime() <= now) return setError(t("Pick a time in the future."));
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        deadline: noDeadline ? null : when.toISOString(),
        durationMin: (() => {
          const t = totalMinutes(hours, mins);
          return t ? clampDuration(t) : null;
        })(),
        pacing: pacingOf(task),
        description: notes,
      });
    } catch {
      setError(t("Couldn't save. Please try again."));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-xs text-muted">
        <span className="flex justify-between"><span>{t("Title")}</span><span aria-live="polite">{title.length}/100</span></span>
        <input autoFocus required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)}
          className={`${field} mt-1 text-foreground`} />
      </label>
      <DeadlineField value={deadline} none={noDeadline} onValue={setDeadline} onNone={setNoDeadline} />
      <div className="text-xs text-muted">
        <span className="mb-1 block">{t("Duration")}</span>
        <DurationFields hours={hours} minutes={mins} onHours={setHours} onMinutes={setMins} />
      </div>
      <label className="block text-xs text-muted">
        {t("Notes")}
        <textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)}
          className={`${field} mt-1 resize-none text-foreground`} />
      </label>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save")}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}
          className="glass rounded-full px-5 py-2.5 text-sm text-muted transition hover:text-foreground disabled:opacity-60">
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}
