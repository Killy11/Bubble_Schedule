"use client";

import { useState } from "react";
import { Check, Clock, Flag, Loader2, Minus, Pause, Pencil, Play, Plus, Repeat, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import { useSecondTick } from "@/hooks/useSecondTick";
import { formatClock, parseClock, progressOf, remainingSeconds, spentSeconds, STEP_MIN } from "@/lib/remaining";
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
}

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const field =
  "glass w-full rounded-2xl px-4 py-2.5 text-sm outline-none transition focus:border-[rgb(var(--glow-a))] placeholder:text-muted";

const CHIPS = [
  { label: "+15m", min: 15 },
  { label: "+30m", min: 30 },
  { label: "+1h", min: 60 },
];


export function TaskDetailSheet({
  task,
  now,
  onClose,
  onComplete,
  onDelete,
  onLogTime,
  onStartTimer,
  onStopTimer,
  onResetTimer,
  onAdjust,
  onSetRecurrence,
  onEdit,
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
  /** Add time spent, in exact seconds. */
  onLogTime: (t: Task, seconds: number) => Promise<void>;
  onStartTimer: (t: Task) => Promise<void>;
  onStopTimer: (t: Task) => Promise<void>;
  onResetTimer: (t: Task) => Promise<void>;
  /** Move the planned / remaining time by whole minutes (±15). */
  onAdjust: (t: Task, deltaMin: number) => Promise<void>;
  onSetRecurrence: (t: Task, r: Recurrence | null) => Promise<void>;
  onEdit: (t: Task, patch: TaskEdit) => Promise<void>;
  splitting: boolean;
  onToggleSubtask: (t: Task, sub: Subtask, checked: boolean) => Promise<void>;
  onSaveSubtasks: (t: Task, subs: Subtask[]) => Promise<void>;
  onSplit: (t: Task, parts?: number) => void;
}) {
  const { t, lang } = useLang();
  const [busy, setBusy] = useState(false);
  const [actual, setActual] = useState("");
  const [editing, setEditing] = useState(false);
  const close = () => {
    setEditing(false);
    onClose();
  };
  const run = async (fn: (t: Task) => Promise<void>) => {
    if (!task) return;
    setBusy(true);
    close(); // close first so the bubble can pop
    try { await fn(task); } finally { setBusy(false); }
  };
  const tracked = task ? Math.round(spentSeconds(task, now) / 60) : 0;
  const dur = task && effectiveDuration(task);
  const hue = task ? bubbleHue(task, now) : "green";
  const guessed = task && !task.durationMin && task.aiEstimate;

  return (
    <Sheet open={!!task} onClose={close} title={task?.title ?? ""}>
      {task && (
        <div className={`space-y-5 hue-${hue}`}>
          {editing ? (
            <EditForm key={task.id} task={task} now={now} onCancel={() => setEditing(false)}
              onSave={async (patch) => { await onEdit(task, patch); setEditing(false); }} />
          ) : (
          <>
          {/* Quick complete, time spent / left and the live timer: first thing in the modal */}
          <ProgressTimer
            key={`progress-${task.id}`}
            task={task}
            busy={busy}
            onComplete={() => void run((x) => onComplete(x))}
            onAdjust={onAdjust}
            onStart={onStartTimer}
            onPause={onStopTimer}
            onReset={onResetTimer}
          />
          <div className="flex items-center gap-2">
            <span className="hue-badge">
              <span className="hue-dot h-2 w-2 rounded-full" /> {t(HUE_META[hue].label)}
            </span>
            <span className="text-xs text-muted">{t(HUE_META[hue].hint)}</span>
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted"><Clock className="h-4 w-4" />
              <span className="text-foreground">
                {task.deadline ? `${t("Due")} ${formatDeadline(task.deadline, now, t, lang)}` : t("No deadline")}
              </span></div>
            <div className="flex items-center gap-2 text-muted"><Flag className="h-4 w-4" />
              <span className="text-foreground">
                {dur ? t("Takes {d}", { d: formatDuration(dur, t) }) : t("Standard size")}
                {guessed ? ` (${t("AI estimate")})` : ""}
              </span></div>
            {task.aiEstimate?.reasoning && (
              <div className="flex items-start gap-2 text-muted"><Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{task.aiEstimate.reasoning}</span></div>
            )}
          </dl>
          <button type="button" onClick={() => setEditing(true)}
            className="glass flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs text-muted transition hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" /> {t("Edit")}
          </button>
          </>
          )}

          <SubtaskList
            key={`parts-${task.id}`}
            task={task}
            now={now}
            splitting={splitting}
            onToggle={onToggleSubtask}
            onSave={onSaveSubtasks}
            onSplit={onSplit}
          />

          <TimeLogger key={task.id} task={task} onLogTime={onLogTime} />

          {task.deadline && <section className="space-y-2">
            <p className="flex items-center gap-2 text-xs text-muted"><Repeat className="h-3.5 w-3.5" /> {t("Repeat")}</p>
            <RecurrencePicker
              key={task.id}
              value={task.recurrence ?? null}
              anchorDow={new Date(task.deadline ?? now).getDay()}
              onChange={(r) => void onSetRecurrence(task, r)}
            />
          </section>}

          <label className="block text-xs text-muted">
            {t("How long did it take? (min)")}
            <input
              key={task.id}
              type="number" inputMode="numeric" min={1} max={1440} value={actual}
              onChange={(e) => setActual(e.target.value)}
              placeholder={tracked > 0 ? t("{n} tracked", { n: tracked }) : dur ? t("about {n}", { n: dur }) : "45"}
              className="glass mt-1 w-full rounded-full px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-[rgb(var(--glow-a))]"
            />
          </label>

          <div className="flex gap-3">
            <button disabled={busy} onClick={() => {
                const n = Number(actual);
                const value = actual && Number.isFinite(n) && n >= 1 ? Math.min(1440, Math.round(n)) : undefined;
                setActual("");
                void run((t) => onComplete(t, value));
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
      )}
    </Sheet>
  );
}

/** The big top section: Complete, Time spent / Time left (MM:SS), ±15m, and Start / Pause / Reset. */
function ProgressTimer({
  task, busy, onComplete, onAdjust, onStart, onPause, onReset,
}: {
  task: Task;
  busy: boolean;
  onComplete: () => void;
  onAdjust: (t: Task, deltaMin: number) => Promise<void>;
  onStart: (t: Task) => Promise<void>;
  onPause: (t: Task) => Promise<void>;
  onReset: (t: Task) => Promise<void>;
}) {
  const { t } = useLang();
  const running = !!task.startedAt;
  const tick = useSecondTick(running); // per-second only while the timer runs
  const spent = spentSeconds(task, tick);
  const left = remainingSeconds(task, tick);
  const pct = Math.round(progressOf(task, tick) * 100);
  const [pending, setPending] = useState(false);
  const act = async (fn: () => Promise<void>) => {
    setPending(true);
    try { await fn(); } catch { /* the dashboard shows its own error toast */ } finally { setPending(false); }
  };
  const small = "flex h-9 items-center justify-center gap-1.5 rounded-full border border-line px-3 text-xs transition hover:bg-foreground/10 disabled:opacity-50";

  return (
    <section className="glass space-y-3 rounded-2xl p-4">
      <button
        type="button"
        disabled={busy}
        onClick={onComplete}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60"
      >
        <Check className="h-4 w-4" /> {t("Complete")}
      </button>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-foreground/5 px-2 py-2">
          <p className="text-[11px] text-muted">{t("Time spent")}</p>
          <p className="text-xl font-semibold tabular-nums">{formatClock(spent * 1000)}</p>
        </div>
        <div className="rounded-xl bg-foreground/5 px-2 py-2">
          <p className="text-[11px] text-muted">{t("Time left")}</p>
          <p className="text-xl font-semibold tabular-nums">{formatClock(left * 1000)}</p>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: "rgb(var(--c))" }} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex gap-1.5">
          <button type="button" disabled={pending} onClick={() => act(() => onAdjust(task, -STEP_MIN))} className={small} aria-label={t("{n}m", { n: `−${STEP_MIN}` })}>
            <Minus className="h-3 w-3" />{STEP_MIN}m
          </button>
          <button type="button" disabled={pending} onClick={() => act(() => onAdjust(task, STEP_MIN))} className={small} aria-label={t("{n}m", { n: `+${STEP_MIN}` })}>
            <Plus className="h-3 w-3" />{STEP_MIN}m
          </button>
        </span>
        <span className="flex gap-1.5">
          <button type="button" disabled={pending} onClick={() => act(() => (running ? onPause(task) : onStart(task)))} aria-pressed={running}
            className={`${small} ${running ? "" : "bg-foreground/10"}`}>
            {running ? <><Pause className="h-3.5 w-3.5 fill-current" /> {t("Pause")}</> : <><Play className="h-3.5 w-3.5 fill-current" /> {t("Start timer")}</>}
          </button>
          <button type="button" disabled={pending || (spent < 1 && !running)} onClick={() => act(() => onReset(task))} className={small} aria-label={t("Reset")} title={t("Reset")}>
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </section>
  );
}

/** Manual time logging: quick chips, or type any duration (14:23, 45s, 12.5). */
function TimeLogger({ task, onLogTime }: { task: Task; onLogTime: (t: Task, seconds: number) => Promise<void> }) {
  const { t } = useLang();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function log(seconds: number) {
    setError(null);
    setSaving(true);
    try {
      await onLogTime(task, seconds);
      setValue("");
    } catch {
      setError(t("Couldn't save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass space-y-3 rounded-2xl p-4">
      <p className="text-xs text-muted">{t("Log time spent")}</p>
      <div className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button key={c.label} type="button" disabled={saving} onClick={() => log(c.min * 60)}
            className="glass rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-50">
            {c.label}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const sec = parseClock(value); // any time above zero is fine, down to a single second
          if (sec === null) return setError(t("Enter a time like 14:23, 45s or 12.5"));
          void log(sec);
        }}
      >
        <input type="text" inputMode="text" value={value} onChange={(e) => setValue(e.target.value)}
          placeholder="14:23" aria-label={t("Log time spent")}
          className="glass min-w-0 flex-1 rounded-full px-4 py-2 text-sm outline-none placeholder:text-muted focus:border-[rgb(var(--glow-a))]" />
        <button type="submit" disabled={saving || !value}
          className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {t("Save")}
        </button>
      </form>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
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
