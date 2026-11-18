"use client";

import { useState } from "react";
import { ArrowLeft, BellRing, Check, Clock, Loader2, Minus, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useNotifications } from "@/context/NotificationProvider";
import { useSecondTick } from "@/hooks/useSecondTick";
import { formatClock, progressOf, remainingMinutes, remainingSeconds, sessionSeconds, spentMinutes, STEP_MIN } from "@/lib/remaining";
import { Sheet } from "@/components/Sheet";
import { DeadlineField } from "@/components/DeadlineField";
import { useLang } from "@/context/LanguageProvider";
import { pacingOf } from "@/lib/pacing";
import { formatDeadline } from "@/lib/time";
import { bubbleHue, HUE_META } from "@/lib/bubbles/urgency";
import type { Pacing, Task } from "@/types";

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
  onSetRemaining,
  onEdit,
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
  /** Set the time left to an exact whole number of minutes. */
  onSetRemaining: (t: Task, minutes: number) => Promise<void>;
  onEdit: (t: Task, patch: TaskEdit) => Promise<void>;
}) {
  const hue = task ? bubbleHue(task, now) : "green";
  return (
    <Sheet open={!!task} onClose={onClose} title={task?.title ?? ""}>
      {/* keyed by task: every time a bubble is opened the modal starts on the Timer view */}
      {task && (
        <div className={`hue-${hue}`}>
          <Body key={task.id} {...{ task, now, onClose, onComplete, onDelete, onStartTimer, onStopTimer, onConfirmTimer, onAdjust, onSetRemaining, onEdit }} />
        </div>
      )}
    </Sheet>
  );
}

type BodyProps = Omit<Parameters<typeof TaskDetailSheet>[0], "task"> & { task: Task };

function Body({
  task, now, onClose, onComplete, onDelete, onStartTimer, onStopTimer, onConfirmTimer, onAdjust, onSetRemaining, onEdit,
}: BodyProps) {
  const { t, lang } = useLang();
  // Step 1 is the Timer & Quick Actions view; Step 2 (the full form) opens only from its Edit button.
  const [view, setView] = useState<"timer" | "edit">("timer");
  const [busy, setBusy] = useState(false);
  const hue = bubbleHue(task, now);

  const run = async (fn: (t: Task) => Promise<void>) => {
    setBusy(true);
    onClose(); // close first so the bubble can pop
    try { await fn(task); } finally { setBusy(false); }
  };

  if (view === "edit") {
    // Step 2: only the essentials. Times of day are set through the AI chat, not here.
    return (
      <div className="space-y-5">
        <button type="button" onClick={() => setView("timer")}
          className="glass flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs text-muted transition hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> {t("Back")}
        </button>
        <EditForm task={task} now={now} onCancel={() => setView("timer")} onDelete={() => void run(onDelete)} busy={busy}
          onSave={async (patch) => { await onEdit(task, patch); setView("timer"); }} />
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
      </div>

      <ProgressTimer
        task={task}
        busy={busy}
        onComplete={() => void run((x) => onComplete(x))}
        onAdjust={onAdjust}
        onSetRemaining={onSetRemaining}
        onStart={onStartTimer}
        onPause={onStopTimer}
        onConfirm={onConfirmTimer}
      />

      <button type="button" onClick={() => setView("edit")}
        className="glass flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-foreground transition hover:brightness-125">
        <Pencil className="h-4 w-4" /> {t("Edit")}
      </button>
    </div>
  );
}

/** The time left, in whole minutes: click and type any integer, saved on blur or Enter. */
function RemainingInput({ task, onSet }: { task: Task; onSet: (t: Task, minutes: number) => Promise<void> }) {
  const { t } = useLang();
  const current = remainingMinutes(task);
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
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <span className="sr-only">{t("Time left")} ({t("min")})</span>
      <input
        type="number" inputMode="numeric" step={1} min={0} max={1440}
        value={draft ?? String(current)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setDraft(null); }}
        className="glass h-9 w-16 rounded-xl text-center text-base tabular-nums text-foreground outline-none focus:border-[rgb(var(--glow-a))]"
      />
      {t("min")}
    </label>
  );
}

/** Step 1: whole-minute summary, the live MM:SS timer, Start / Pause, Stop & confirm, ±15 min and Complete. */
function ProgressTimer({
  task, busy, onComplete, onAdjust, onSetRemaining, onStart, onPause, onConfirm,
}: {
  task: Task;
  busy: boolean;
  onComplete: () => void;
  onAdjust: (t: Task, deltaMin: number) => Promise<void>;
  onSetRemaining: (t: Task, minutes: number) => Promise<void>;
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
        {t("Left: {n} min", { n: remainingMinutes(task) })} · {t("Spent: {n} min", { n: spentMinutes(task) })}
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

      {/* time left: −15 / a whole-minute number you can type / +15 */}
      <div className="flex items-center justify-center gap-2">
        <button type="button" disabled={pending} onClick={() => act(() => onAdjust(task, -STEP_MIN))} className={small} aria-label={t("{n}m", { n: `−${STEP_MIN}` })}>
          <Minus className="h-3 w-3" />{STEP_MIN} {t("min")}
        </button>
        <RemainingInput task={task} onSet={onSetRemaining} />
        <button type="button" disabled={pending} onClick={() => act(() => onAdjust(task, STEP_MIN))} className={small} aria-label={t("{n}m", { n: `+${STEP_MIN}` })}>
          <Plus className="h-3 w-3" />{STEP_MIN} {t("min")}
        </button>
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
  onDelete,
  busy: outerBusy,
}: {
  task: Task;
  now: number;
  onSave: (patch: TaskEdit) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { t } = useLang();
  const [title, setTitle] = useState(task.title);
  const [deadline, setDeadline] = useState(task.deadline ? toLocalInput(task.deadline) : "");
  const [noDeadline, setNoDeadline] = useState(!task.deadline);
  const [remaining, setRemaining] = useState(String(remainingMinutes(task)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const when = new Date(deadline);
    if (!title.trim()) return setError(t("Give your bubble a title."));
    if (!noDeadline && Number.isNaN(when.getTime())) return setError(t("Pick a deadline."));
    if (!noDeadline && when.getTime() <= now) return setError(t("Pick a time in the future."));
    const left = Math.max(0, Math.floor(Number(remaining)));
    if (!Number.isFinite(left)) return setError(t("Enter whole minutes."));
    setBusy(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        deadline: noDeadline ? null : when.toISOString(),
        // The time left is what the user edits; the planned duration is what has been spent plus what is left.
        durationMin: Math.min(1440, spentMinutes(task) + left),
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
        <span className="flex justify-between"><span>{t("Task title")}</span><span aria-live="polite">{title.length}/100</span></span>
        <input autoFocus required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)}
          className={`${field} mt-1 text-foreground`} />
      </label>
      <label className="block text-xs text-muted">
        {t("Minutes left")}
        <input type="number" inputMode="numeric" step={1} min={0} max={1440} value={remaining}
          onChange={(e) => setRemaining(e.target.value)}
          className={`${field} mt-1 text-base text-foreground`} />
      </label>
      <DeadlineField value={deadline} none={noDeadline} onValue={setDeadline} onNone={setNoDeadline} />
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={busy || outerBusy}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Save")}
        </button>
        <button type="button" onClick={onDelete} disabled={busy || outerBusy} aria-label={t("Delete")}
          className="glass flex items-center justify-center gap-1.5 rounded-full px-4 text-sm text-muted transition hover:text-red-500 disabled:opacity-60">
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
