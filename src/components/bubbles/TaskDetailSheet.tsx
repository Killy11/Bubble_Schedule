"use client";

import { useState } from "react";
import { Check, Clock, Flag, Loader2, Pencil, Play, Repeat, Sparkles, Square, Trash2 } from "lucide-react";
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
  onLogTime: (t: Task, minutes: number) => Promise<void>;
  onStartTimer: (t: Task) => Promise<void>;
  onStopTimer: (t: Task) => Promise<void>;
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
  const timerMin = task?.startedAt ? Math.max(0, Math.floor((now - Date.parse(task.startedAt)) / 60_000)) : 0;
  const tracked = (task?.loggedMinutes ?? 0) + timerMin;
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

          <TimeLogger
            key={task.id}
            task={task}
            total={dur || undefined}
            timerMin={timerMin}
            onLogTime={onLogTime}
            onStartTimer={onStartTimer}
            onStopTimer={onStopTimer}
          />

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

function TimeLogger({
  task,
  total,
  timerMin,
  onLogTime,
  onStartTimer,
  onStopTimer,
}: {
  task: Task;
  total?: number;
  timerMin: number;
  onLogTime: (t: Task, minutes: number) => Promise<void>;
  onStartTimer: (t: Task) => Promise<void>;
  onStopTimer: (t: Task) => Promise<void>;
}) {
  const { t } = useLang();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const logged = task.loggedMinutes ?? 0;
  const remaining = total ? Math.max(0, total - logged) : undefined;
  const pct = total ? Math.min(100, Math.round((logged / total) * 100)) : 0;

  async function log(minutes: number) {
    setError(null);
    setSaving(true);
    try {
      await onLogTime(task, minutes);
      setValue("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Couldn't save"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass space-y-3 rounded-2xl p-4">
      <div>
        <p className="text-sm">
          {total
            ? t("{a} / {b} spent · {c} left", { a: formatDuration(logged, t), b: formatDuration(total, t), c: formatDuration(remaining ?? 0, t) })
            : t("{a} spent", { a: formatDuration(logged, t) })}
        </p>
        {total && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar"
            aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: "rgb(var(--c))" }} />
          </div>
        )}
        {total && logged > total && (
          <p className="mt-1 text-xs text-muted">{t("Over by {d}", { d: formatDuration(logged - total, t) })}</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted">{task.startedAt ? `${t("Timer running")} · ${formatDuration(timerMin, t)}` : t("Working on it now?")}</span>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setError(null);
            setSaving(true);
            try { await (task.startedAt ? onStopTimer(task) : onStartTimer(task)); }
            catch { setError(t("Couldn't update the timer")); }
            finally { setSaving(false); }
          }}
          className="flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
        >
          {task.startedAt ? <><Square className="h-3 w-3 fill-current" /> {t("Stop")}</> : <><Play className="h-3 w-3 fill-current" /> {t("Start timer")}</>}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button key={c.label} type="button" disabled={saving} onClick={() => log(c.min)}
            className="glass rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-50">
            {c.label}
          </button>
        ))}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(value);
          if (!Number.isInteger(n) || n < 1 || n > 1440) return setError(t("Enter 1–1440 minutes"));
          void log(n);
        }}
      >
        <input type="number" inputMode="numeric" min={1} max={1440} value={value}
          onChange={(e) => setValue(e.target.value)} placeholder={t("Minutes spent")}
          aria-label={t("Minutes spent")}
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
