"use client";

import { useRef, useState } from "react";
import { Repeat } from "lucide-react";
import { RecurrencePicker } from "./RecurrencePicker";
import { SubtaskList } from "./SubtaskList";
import { ArrowLeft, BellRing, Check, Clock, Loader2, Minus, Music, Pause, Pencil, Play, Plus, Trash2, VolumeX } from "lucide-react";
import { useNotifications } from "@/context/NotificationProvider";
import { useMusicMuted } from "@/hooks/useTaskMusic";
import { setMusicMuted } from "@/lib/taskMusic";
import { useSecondTick } from "@/hooks/useSecondTick";
import { formatClock, progressOf, remainingMinutes, remainingSeconds, sessionSeconds, spentMinutes, STEP_MIN, totalMinutes } from "@/lib/remaining";
import { Sheet } from "@/components/Sheet";
import { DeadlineField } from "@/components/DeadlineField";
import { DurationFields, snap5 } from "@/components/DurationFields";
import { useLang } from "@/context/LanguageProvider";
import { PacingSelector } from "@/components/PacingSelector";
import { isTutorialActive } from "@/lib/tutorialLock";
import { pacingOf } from "@/lib/pacing";
import { formatDeadline } from "@/lib/time";
import { bubbleHue, HUE_META } from "@/lib/bubbles/urgency";
import type { Pacing, Recurrence, Subtask, Task } from "@/types";

export interface TaskEdit {
  title: string;
  deadline: string | null; // ISO, or null = no deadline
  durationMin: number | null;
  pacing: Pacing;
  /** Set when the user changed the time left / spent in the editor. */
  loggedMinutes?: number;
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
  onAdjustSpent,
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
  onComplete: (t: Task, actualMin?: number) => Promise<void>;
  onDelete: (t: Task) => Promise<void>;
  onStartTimer: (t: Task) => Promise<void>;
  /** Pause. */
  onStopTimer: (t: Task) => Promise<void>;
  /** Stop & commit: credits the session's whole minutes (rounded down). Returns the minutes credited. */
  onConfirmTimer: (t: Task) => Promise<number>;
  /** Log or take back time in exact 15-minute steps (spent ± 15; the time left follows). */
  onAdjustSpent: (t: Task, deltaMin: number) => Promise<void>;
  onSetRecurrence: (t: Task, r: Recurrence | null) => Promise<void>;
  onEdit: (t: Task, patch: TaskEdit) => Promise<void>;
  splitting: boolean;
  onToggleSubtask: (t: Task, sub: Subtask, checked: boolean) => Promise<void>;
  onSaveSubtasks: (t: Task, subs: Subtask[]) => Promise<void>;
  onSplit: (t: Task, parts?: number) => void;
}) {
  const hue = task ? bubbleHue(task, now) : "green";
  return (
    <Sheet open={!!task} onClose={onClose} title={task?.title ?? ""} tourId="task" closeTourId="close-task-modal">
      {/* keyed by task: every time a bubble is opened the modal starts on the Timer view */}
      {task && (
        <div className={`hue-${hue}`}>
          <Body key={task.id} {...{ task, now, onClose, onComplete, onDelete, onStartTimer, onStopTimer, onConfirmTimer, onAdjustSpent, onSetRecurrence, onEdit, splitting, onToggleSubtask, onSaveSubtasks, onSplit }} />
        </div>
      )}
    </Sheet>
  );
}

type BodyProps = Omit<Parameters<typeof TaskDetailSheet>[0], "task"> & { task: Task };

function Body({
  task, now, onClose, onComplete, onDelete, onStartTimer, onStopTimer, onConfirmTimer, onAdjustSpent, onSetRecurrence, onEdit,
  splitting, onToggleSubtask, onSaveSubtasks, onSplit,
}: BodyProps) {
  const { t, lang } = useLang();
  // Step 1 is Timer & Progress; Step 2 (the full edit tablo) opens only from its Edit button.
  const [view, setView] = useState<"timer" | "edit">("timer");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const hue = bubbleHue(task, now);

  const run = async (fn: (t: Task) => Promise<void>) => {
    setBusy(true);
    onClose(); // close first so the bubble can pop
    try { await fn(task); } finally { setBusy(false); }
  };

  if (view === "edit") {
    return (
      <div className="flex flex-col gap-5">
        <button type="button" onClick={() => setView("timer")}
          className="glass flex w-fit items-center gap-1.5 rounded-full px-4 py-1.5 text-xs text-muted transition hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("Back")}
        </button>

        <EditForm task={task} now={now} formRef={formRef} onBusy={setSaving}
          onSave={async (patch) => {
            await onEdit(task, patch);
            // Saving with all the planned time used up (spent ≥ total, nothing left) completes the task.
            const spentAfter = patch.loggedMinutes ?? spentMinutes(task);
            const totalAfter = patch.durationMin ?? totalMinutes(task);
            if (totalAfter > 0 && spentAfter >= totalAfter) {
              void run((x) => onComplete({ ...x, durationMin: totalAfter, loggedMinutes: spentAfter }, spentAfter));
              return;
            }
            setView("timer");
          }} />

        <SubtaskList key={`parts-${task.id}`} task={task} now={now} splitting={splitting}
          onToggle={onToggleSubtask} onSave={onSaveSubtasks} onSplit={onSplit} />

        {task.deadline && (
          <section className="space-y-2">
            <p className="flex items-center gap-2 text-xs text-muted"><Repeat className="h-3.5 w-3.5" /> {t("Repeat")}</p>
            <RecurrencePicker value={task.recurrence ?? null} anchorDow={new Date(task.deadline).getDay()}
              onChange={(r) => void onSetRecurrence(task, r)} />
          </section>
        )}

        {/* footer: a subtle Delete, then Save as the very last element */}
        <div className="mt-auto space-y-3 border-t border-line pt-4">
          <button type="button" onClick={() => void run(onDelete)} disabled={busy || saving}
            className="mx-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-red-500 disabled:opacity-60">
            <Trash2 className="h-3.5 w-3.5" /> {t("Delete task")}
          </button>
          <button type="button" onClick={() => formRef.current?.requestSubmit()} disabled={busy || saving}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="hue-badge"><span className="hue-dot h-2 w-2 rounded-full" /> {t(HUE_META[hue].label)}</span>
        <span className="text-xs text-muted">{t(HUE_META[hue].hint)}</span>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <Clock className="h-3.5 w-3.5" />
          {task.deadline ? `${t("Due")} ${formatDeadline(task.deadline, now, t, lang)}` : t("No deadline")}
        </span>
      </div>

      <ProgressTimer
        task={task}
        busy={busy}
        onComplete={() => void run((x) => onComplete(x))}
        onAutoComplete={(actual) => void run((x) => onComplete(x, actual))}
        onAdjustSpent={onAdjustSpent}
        onStart={onStartTimer}
        onPause={onStopTimer}
        onConfirm={onConfirmTimer}
      />

      <div data-tour="modal-actions" className="space-y-4">
        <button type="button" onClick={() => setView("edit")}
          className="glass flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-foreground transition hover:brightness-125">
          <Pencil className="h-4 w-4" /> {t("Edit task")}
        </button>
        {/* set apart at the very bottom: finishing the whole task is different from logging time */}
        <div className="border-t border-line pt-4">
          <p className="mb-2 text-center text-xs text-muted">{t("Is the whole task finished?")}</p>
          <button type="button" data-tour="done-btn" disabled={busy} onClick={() => void run((x) => onComplete(x))}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
            🎉 {t("Finish task")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Step 1: totals, then the live timer, then logging minutes by hand, then (set apart) completing the whole task. */
function ProgressTimer({
  task, busy, onComplete, onAutoComplete, onAdjustSpent, onStart, onPause, onConfirm,
}: {
  task: Task;
  busy: boolean;
  onComplete: () => void;
  /** Spent time reached the total: complete the task (the modal closes and the bubble pops). */
  onAutoComplete: (actualMin: number) => void;
  onAdjustSpent: (t: Task, deltaMin: number) => Promise<void>;
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
  const muted = useMusicMuted();
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [minutes, setMinutes] = useState("15"); // minutes to log by hand
  const act = async (fn: () => Promise<void>) => {
    if (pending) return; // one click, one change
    setPending(true);
    try { await fn(); } catch { /* the dashboard shows its own error toast */ } finally { setPending(false); }
  };
  const flash = (text: string) => {
    setNote(text);
    setTimeout(() => setNote((n) => (n === text ? null : n)), 3000);
  };
  const toMin = (v: string) => Math.min(1440, Math.max(1, Math.floor(Number(v)) || 1));
  const stepBtn = "flex h-10 shrink-0 items-center justify-center gap-1 rounded-full border border-line px-3 text-sm transition hover:bg-foreground/10 disabled:opacity-50";

  return (
    <div className="space-y-3">
      {timeUp && (
        <div role="alert" className="space-y-2 rounded-xl border border-[rgb(var(--c)/0.5)] bg-[rgb(var(--c)/0.1)] p-3">
          <p className="text-sm font-medium">⏰ {t("Time's up!")}</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={onComplete}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-60">
              <Check className="h-3.5 w-3.5" /> {t("Done")}
            </button>
            <button type="button" disabled={pending} onClick={() => act(() => onAdjustSpent(task, -STEP_MIN))}
              className="flex-1 rounded-full border border-line px-3 py-2 text-xs transition hover:bg-foreground/10 disabled:opacity-60">
              {t("{n}m", { n: `+${STEP_MIN}` })}
            </button>
          </div>
        </div>
      )}

      {/* read-only whole-minute summary */}
      <div className="glass rounded-2xl p-3">
        <p className="text-center text-sm tabular-nums">
          {t("Total: {n} min", { n: totalMinutes(task) })} <span className="text-muted">•</span> {t("Spent: {n} min", { n: spentMinutes(task) })}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: "rgb(var(--c))" }} />
        </div>
      </div>

      {/* Card 1: live timer */}
      <section data-tour="timer-clock" className="glass space-y-2.5 rounded-2xl p-4">
        <p className="text-xs font-medium text-muted">{t("Live timer")}</p>
        <div className="grid grid-cols-2 gap-2 text-center">
          <div><p className="text-[11px] text-muted">{t("Elapsed")}</p><p className="text-2xl font-semibold tabular-nums">{formatClock(session * 1000)}</p></div>
          <div><p className="text-[11px] text-muted">{t("Time left")}</p><p className="text-2xl font-semibold tabular-nums">{formatClock(left * 1000)}</p></div>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={() => { setNote(null); void act(() => (running ? onPause(task) : onStart(task))); }}
            aria-pressed={running}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-foreground/10 text-sm font-medium transition hover:bg-foreground/15 disabled:opacity-50">
            {running ? <><Pause className="h-4 w-4 fill-current" /> {t("Pause")}</> : <><Play className="h-4 w-4 fill-current" /> {t("Start timer")}</>}
          </button>
          <button type="button" disabled={pending || !hasSession}
            onClick={() => act(async () => {
              const n = await onConfirm(task);
              const after = spentMinutes(task) + n;
              if (after >= totalMinutes(task)) return onAutoComplete(after); // used up the planned time: done
              flash(t("Logged +{n} min", { n }));
            })}
            className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-sm transition hover:bg-foreground/10 disabled:opacity-40">
            <Check className="h-4 w-4" /> {t("Log minutes")}
          </button>
        </div>
        {running && (
          <button type="button" onClick={() => setMusicMuted(!muted)} aria-pressed={muted}
            className="mx-auto flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-muted transition hover:text-foreground">
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Music className="h-3.5 w-3.5" />} {muted ? t("Music: off") : t("Music: on")}
          </button>
        )}
      </section>

      {/* Card 2: log time without the timer */}
      <section data-tour="time-log" className="glass space-y-2.5 rounded-2xl p-4">
        <p className="text-xs font-medium text-muted">{t("Log time manually")}</p>
        <div className="block text-xs text-muted">
          <div className="flex items-center justify-center gap-2">
            <button type="button" disabled={pending} onClick={() => setMinutes(String(Math.max(1, toMin(minutes) - STEP_MIN)))} aria-label={t("{n}m", { n: `−${STEP_MIN}` })} className={stepBtn}>
              <Minus className="h-3.5 w-3.5" />{STEP_MIN}
            </button>
            <input type="number" inputMode="numeric" step={1} min={1} max={1440} value={minutes}
              onChange={(e) => setMinutes(e.target.value)} onFocus={(e) => e.target.select()}
              onBlur={() => setMinutes(String(toMin(minutes)))}
              className="glass h-10 w-20 rounded-xl text-center text-base tabular-nums text-foreground outline-none focus:border-[rgb(var(--glow-a))]" />
            <button type="button" disabled={pending} onClick={() => setMinutes(String(Math.min(1440, toMin(minutes) + STEP_MIN)))} aria-label={t("{n}m", { n: `+${STEP_MIN}` })} className={stepBtn}>
              <Plus className="h-3.5 w-3.5" />{STEP_MIN}
            </button>
          </div>
        </div>
        <button type="button" disabled={pending}
          onClick={() => {
            const n = toMin(minutes);
            const after = spentMinutes(task) + n;
            if (after >= totalMinutes(task)) return onAutoComplete(after); // the planned time is used up: the task is done
            void act(async () => { await onAdjustSpent(task, n); flash(t("Logged +{n} min", { n })); });
          }}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground/10 px-4 py-2.5 text-sm font-medium transition hover:bg-foreground/15 disabled:opacity-50">
          {t("Log {n} min", { n: toMin(minutes) })}
        </button>
        {note && <p role="status" className="text-center text-xs text-emerald-600 dark:text-emerald-400">{note}</p>}
      </section>

      {permission === "default" && (
        <button type="button" disabled={enabling} onClick={() => void enable()}
          className="flex w-full items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-foreground">
          <BellRing className="h-3.5 w-3.5" /> {t("🔔 Enable timer completion notifications")}
        </button>
      )}

    </div>
  );
}

/** Step 2: the edit fields. Save lives in the footer below (it submits this form through `formRef`). */
function EditForm({
  task, now, onSave, formRef, onBusy,
}: {
  task: Task;
  now: number;
  onSave: (patch: TaskEdit) => Promise<void>;
  formRef: React.RefObject<HTMLFormElement | null>;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useLang();
  const spent = spentMinutes(task);
  const [title, setTitle] = useState(task.title);
  const [deadline, setDeadline] = useState(task.deadline ? toLocalInput(task.deadline) : "");
  const [noDeadline, setNoDeadline] = useState(!task.deadline);
  // Durations are picked from dropdowns in 5-minute steps (nothing typed, so the browser never rejects a value).
  const split = (min: number) => ({ h: String(Math.floor(snap5(min) / 60)), m: String(snap5(min) % 60) });
  const [tot, setTot] = useState(() => split(totalMinutes(task)));
  const [lft, setLft] = useState(() => split(remainingMinutes(task)));
  const [totalTouched, setTotalTouched] = useState(false);
  const [leftTouched, setLeftTouched] = useState(false);
  const minsOf = (x: { h: string; m: string }) => Number(x.h) * 60 + Number(x.m);
  const [pacing, setPacing] = useState<Pacing>(pacingOf(task));
  const [error, setError] = useState<string | null>(null);
  const hue = bubbleHue(task, now);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const when = new Date(deadline);
    if (!title.trim()) return setError(t("Give your bubble a title."));
    if (!noDeadline && Number.isNaN(when.getTime())) return setError(t("Pick a deadline."));
    if (!noDeadline && when.getTime() <= now) return setError(t("Pick a time in the future."));
    // Untouched fields keep the exact stored minutes; changed ones use the dropdown values.
    const totalMin = totalTouched ? Math.min(1440, Math.max(5, minsOf(tot))) : (task.durationMin ?? totalMinutes(task));
    const leftMin = Math.min(totalMin, Math.max(0, minsOf(lft)));
    onBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        deadline: noDeadline ? null : when.toISOString(),
        durationMin: totalMin,
        pacing,
        // Typing the time left sets what has been spent (total − left); otherwise the spent time stays as it was.
        ...(leftTouched ? { loggedMinutes: totalMin - leftMin } : {}),
      });
    } catch {
      setError(t("Couldn't save. Please try again."));
    } finally {
      onBusy(false);
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      // During the tutorial Enter in a field must not submit the form.
      onKeyDown={(e) => {
        if (e.key === "Enter" && isTutorialActive() && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
      }}
      className="space-y-4"
    >
      <label className="block text-xs text-muted" data-tour="field-title">
        <span className="flex justify-between"><span>{t("Task title")}</span><span aria-live="polite">{title.length}/100</span></span>
        <input required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} mt-1 text-foreground`} />
      </label>

      <div className="space-y-3">
        <div className="text-xs text-muted">
          <span className="mb-1 block">{t("Total duration")}</span>
          <DurationFields hours={tot.h} minutes={tot.m} hint={false} allowBlank={false}
            onHours={(v) => { const n = { ...tot, h: v }; setTot(n); setTotalTouched(true); if (!leftTouched) setLft(split(Math.max(0, minsOf(n) - spent))); }}
            onMinutes={(v) => { const n = { ...tot, m: v }; setTot(n); setTotalTouched(true); if (!leftTouched) setLft(split(Math.max(0, minsOf(n) - spent))); }} />
        </div>
        <div className="text-xs text-muted">
          <span className="mb-1 block">{t("Time left")}</span>
          <DurationFields hours={lft.h} minutes={lft.m} hint={false} allowBlank={false} allowZero
            onHours={(v) => { setLft({ ...lft, h: v }); setLeftTouched(true); }}
            onMinutes={(v) => { setLft({ ...lft, m: v }); setLeftTouched(true); }} />
        </div>
      </div>

      <div className="text-xs text-muted">
        <span className="mb-1 block">{t("Focus intensity")}</span>
        <PacingSelector value={pacing} onChange={setPacing} />
      </div>

      <div className="space-y-2">
        <DeadlineField value={deadline} none={noDeadline} onValue={setDeadline} onNone={setNoDeadline} />
        {/* The colour comes from the deadline alone: there is no manual priority. */}
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {t("Colour")}: <span className="hue-badge"><span className="hue-dot h-2 w-2 rounded-full" /> {t(HUE_META[hue].label)}</span>
          <span>{t(HUE_META[hue].hint)}</span>
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    </form>
  );
}
