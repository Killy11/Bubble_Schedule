"use client";

import { useState } from "react";
import { Repeat } from "lucide-react";
import { RecurrencePicker } from "./RecurrencePicker";
import { SubtaskList } from "./SubtaskList";
import { ArrowLeft, BellRing, Check, Clock, Loader2, Minus, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useNotifications } from "@/context/NotificationProvider";
import { useSecondTick } from "@/hooks/useSecondTick";
import { formatClock, progressOf, remainingMinutes, remainingSeconds, sessionSeconds, spentMinutes, STEP_MIN, totalMinutes } from "@/lib/remaining";
import { Sheet } from "@/components/Sheet";
import { DeadlineField } from "@/components/DeadlineField";
import { useLang } from "@/context/LanguageProvider";
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
  onSetSpent,
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
  /** Type the exact whole minutes already spent (the time left follows). */
  onSetSpent: (t: Task, minutes: number) => Promise<void>;
  onSetRecurrence: (t: Task, r: Recurrence | null) => Promise<void>;
  onEdit: (t: Task, patch: TaskEdit) => Promise<void>;
  splitting: boolean;
  onToggleSubtask: (t: Task, sub: Subtask, checked: boolean) => Promise<void>;
  onSaveSubtasks: (t: Task, subs: Subtask[]) => Promise<void>;
  onSplit: (t: Task, parts?: number) => void;
}) {
  const hue = task ? bubbleHue(task, now) : "green";
  return (
    <Sheet open={!!task} onClose={onClose} title={task?.title ?? ""} tourId="task">
      {/* keyed by task: every time a bubble is opened the modal starts on the Timer view */}
      {task && (
        <div className={`hue-${hue}`}>
          <Body key={task.id} {...{ task, now, onClose, onComplete, onDelete, onStartTimer, onStopTimer, onConfirmTimer, onAdjustSpent, onSetSpent, onSetRecurrence, onEdit, splitting, onToggleSubtask, onSaveSubtasks, onSplit }} />
        </div>
      )}
    </Sheet>
  );
}

type BodyProps = Omit<Parameters<typeof TaskDetailSheet>[0], "task"> & { task: Task };

function Body({
  task, now, onClose, onComplete, onDelete, onStartTimer, onStopTimer, onConfirmTimer, onAdjustSpent, onSetSpent, onSetRecurrence, onEdit,
  splitting, onToggleSubtask, onSaveSubtasks, onSplit,
}: BodyProps) {
  const { t, lang } = useLang();
  // Step 1 is Timer & Progress; Step 2 (the full edit tablo) opens only from its Edit button.
  const [view, setView] = useState<"timer" | "edit">("timer");
  const [busy, setBusy] = useState(false);
  const hue = bubbleHue(task, now);

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
        <EditForm task={task} now={now} onCancel={() => setView("timer")} onDelete={() => void run(onDelete)} busy={busy}
          onSave={async (patch) => { await onEdit(task, patch); setView("timer"); }} />

        <SubtaskList key={`parts-${task.id}`} task={task} now={now} splitting={splitting}
          onToggle={onToggleSubtask} onSave={onSaveSubtasks} onSplit={onSplit} />

        {task.deadline && (
          <section className="space-y-2">
            <p className="flex items-center gap-2 text-xs text-muted"><Repeat className="h-3.5 w-3.5" /> {t("Repeat")}</p>
            <RecurrencePicker value={task.recurrence ?? null} anchorDow={new Date(task.deadline).getDay()}
              onChange={(r) => void onSetRecurrence(task, r)} />
          </section>
        )}
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
        onAdjustSpent={onAdjustSpent}
        onSetSpent={onSetSpent}
        onStart={onStartTimer}
        onPause={onStopTimer}
        onConfirm={onConfirmTimer}
      />

      <button type="button" data-tour="edit-btn" onClick={() => setView("edit")}
        className="glass flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-foreground transition hover:brightness-125">
        <Pencil className="h-4 w-4" /> {t("✎ Edit task")}
      </button>
    </div>
  );
}

/** Time spent in whole minutes: type any integer (saved on blur or Enter); the time left follows. */
function SpentInput({ task, onSet }: { task: Task; onSet: (t: Task, minutes: number) => Promise<void> }) {
  const { t } = useLang();
  const current = spentMinutes(task);
  const [draft, setDraft] = useState<string | null>(null); // null = show the live value
  const commit = async () => {
    const text = draft;
    setDraft(null);
    if (text === null || text.trim() === "") return;
    const typed = Number(text.trim());
    if (!Number.isFinite(typed)) return;
    const n = Math.max(0, Math.floor(typed)); // whole minutes only: no decimals, no seconds
    if (n !== current) await onSet(task, n).catch(() => {});
  };
  return (
    <label className="flex min-w-0 flex-1 flex-col items-center gap-1 text-[11px] text-muted">
      {t("Spent (min)")}
      <input
        type="number" inputMode="numeric" step={1} min={0} max={1440}
        value={draft ?? String(current)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setDraft(null); }}
        className="glass h-10 w-full max-w-[7rem] rounded-xl text-center text-base tabular-nums text-foreground outline-none focus:border-[rgb(var(--glow-a))]"
      />
    </label>
  );
}

/** Step 1: totals, the live MM:SS timer, manual time spent with exact ±15, and Complete. */
function ProgressTimer({
  task, busy, onComplete, onAdjustSpent, onSetSpent, onStart, onPause, onConfirm,
}: {
  task: Task;
  busy: boolean;
  onComplete: () => void;
  onAdjustSpent: (t: Task, deltaMin: number) => Promise<void>;
  onSetSpent: (t: Task, minutes: number) => Promise<void>;
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
    if (pending) return; // one click, one change
    setPending(true);
    try { await fn(); } catch { /* the dashboard shows its own error toast */ } finally { setPending(false); }
  };
  const step = "flex h-10 shrink-0 items-center justify-center gap-1 rounded-full border border-line px-3 text-sm transition hover:bg-foreground/10 disabled:opacity-50";

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
            <button type="button" disabled={pending} onClick={() => act(() => onAdjustSpent(task, -STEP_MIN))}
              className="flex-1 rounded-full border border-line px-3 py-2 text-xs transition hover:bg-foreground/10 disabled:opacity-60">
              {t("{n}m", { n: `+${STEP_MIN}` })}
            </button>
          </div>
        </div>
      )}

      {/* whole-minute totals */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          [t("Total"), totalMinutes(task)],
          [t("Spent"), spentMinutes(task)],
          [t("Left"), remainingMinutes(task)],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-xl bg-foreground/5 px-2 py-2">
            <p className="text-[11px] text-muted">{label}</p>
            <p className="text-lg font-semibold tabular-nums">{n} <span className="text-xs font-normal text-muted">{t("min")}</span></p>
          </div>
        ))}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: "rgb(var(--c))" }} />
      </div>

      {/* live timer */}
      <div data-tour="timer-clock" className="space-y-2 rounded-2xl border border-line p-3">
        <div className="grid grid-cols-2 gap-2 text-center">
          <div><p className="text-[11px] text-muted">{t("Elapsed")}</p><p className="text-2xl font-semibold tabular-nums">{formatClock(session * 1000)}</p></div>
          <div><p className="text-[11px] text-muted">{t("Time left")}</p><p className="text-2xl font-semibold tabular-nums">{formatClock(left * 1000)}</p></div>
        </div>
        <div className="flex gap-2">
          <button type="button" disabled={pending} onClick={() => { setCredited(null); void act(() => (running ? onPause(task) : onStart(task))); }}
            aria-pressed={running} aria-label={running ? t("Pause") : t("Start timer")}
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
        {credited !== null && <p role="status" className="text-center text-xs text-muted">{t("Credited {n} min", { n: credited })}</p>}
      </div>

      {/* manual time spent, for working without the timer: −15 | typed minutes | +15 */}
      <div data-tour="time-log" className="flex items-end justify-center gap-2">
        <button type="button" disabled={pending} onClick={() => act(() => onAdjustSpent(task, -STEP_MIN))} aria-label={t("{n}m", { n: `−${STEP_MIN}` })} className={step}>
          <Minus className="h-3.5 w-3.5" />{STEP_MIN}
        </button>
        <SpentInput task={task} onSet={onSetSpent} />
        <button type="button" disabled={pending} onClick={() => act(() => onAdjustSpent(task, STEP_MIN))} aria-label={t("{n}m", { n: `+${STEP_MIN}` })} className={step}>
          <Plus className="h-3.5 w-3.5" />{STEP_MIN}
        </button>
      </div>

      <button type="button" data-tour="done-btn" disabled={busy} onClick={onComplete}
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

/** Step 2: the full edit tablo. Times of day are set through the AI chat, not here. */
function EditForm({
  task, now, onSave, onCancel, onDelete, busy: outerBusy,
}: {
  task: Task;
  now: number;
  onSave: (patch: TaskEdit) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t } = useLang();
  const spent = spentMinutes(task);
  const [title, setTitle] = useState(task.title);
  const [deadline, setDeadline] = useState(task.deadline ? toLocalInput(task.deadline) : "");
  const [noDeadline, setNoDeadline] = useState(!task.deadline);
  const [total, setTotal] = useState(String(totalMinutes(task)));
  const [left, setLeft] = useState(String(remainingMinutes(task)));
  const [leftTouched, setLeftTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const whole = (v: string) => Math.max(0, Math.floor(Number(v)));
  const hue = bubbleHue(task, now);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const when = new Date(deadline);
    if (!title.trim()) return setError(t("Give your bubble a title."));
    if (!noDeadline && Number.isNaN(when.getTime())) return setError(t("Pick a deadline."));
    if (!noDeadline && when.getTime() <= now) return setError(t("Pick a time in the future."));
    if (!Number.isFinite(Number(total)) || !Number.isFinite(Number(left))) return setError(t("Enter whole minutes."));
    const totalMin = Math.min(1440, Math.max(1, whole(total)));
    const leftMin = Math.min(totalMin, whole(left));
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        deadline: noDeadline ? null : when.toISOString(),
        durationMin: totalMin,
        pacing: pacingOf(task),
        // Typing the time left sets what has been spent (total − left); otherwise the spent time stays as it was.
        ...(leftTouched ? { loggedMinutes: totalMin - leftMin } : {}),
      });
    } catch {
      setError(t("Couldn't save. Please try again."));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-xs text-muted" data-tour="field-title">
        <span className="flex justify-between"><span>{t("Task title")}</span><span aria-live="polite">{title.length}/100</span></span>
        <input required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} mt-1 text-foreground`} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-muted">
          {t("Duration (min)")}
          <input type="number" inputMode="numeric" step={1} min={1} max={1440} value={total}
            onChange={(e) => {
              setTotal(e.target.value);
              if (!leftTouched) setLeft(String(Math.max(0, whole(e.target.value) - spent))); // the time left follows the duration
            }}
            className={`${field} mt-1 text-base text-foreground`} />
        </label>
        <label className="block text-xs text-muted">
          {t("Minutes left")}
          <input type="number" inputMode="numeric" step={1} min={0} max={1440} value={left}
            onChange={(e) => { setLeft(e.target.value); setLeftTouched(true); }}
            className={`${field} mt-1 text-base text-foreground`} />
        </label>
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
      <div className="flex gap-3">
        <button type="submit" disabled={busy || outerBusy}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save")}
        </button>
        <button type="button" onClick={onDelete} disabled={busy || outerBusy}
          className="glass flex items-center justify-center gap-1.5 rounded-full px-5 text-sm text-muted transition hover:text-red-500 disabled:opacity-60">
          <Trash2 className="h-4 w-4" /> {t("Delete")}
        </button>
      </div>
      <button type="button" onClick={onCancel} disabled={busy}
        className="w-full rounded-full py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-60">
        {t("Cancel")}
      </button>
    </form>
  );
}
