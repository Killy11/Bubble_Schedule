"use client";

import { useState } from "react";
import { Check, Clock, Flag, Loader2, Play, Repeat, Sparkles, Square, Trash2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { RecurrencePicker } from "./RecurrencePicker";
import { formatDeadline } from "@/lib/time";
import { effectiveDuration, effectivePriority } from "@/lib/bubbles/effective";
import { bubbleHue, HUE_META } from "@/lib/bubbles/urgency";
import type { Recurrence, Task } from "@/types";

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
}) {
  const [busy, setBusy] = useState(false);
  const [actual, setActual] = useState("");
  const run = async (fn: (t: Task) => Promise<void>) => {
    if (!task) return;
    setBusy(true);
    onClose(); // close first so the bubble can pop
    try { await fn(task); } finally { setBusy(false); }
  };
  const timerMin = task?.startedAt ? Math.max(0, Math.floor((now - Date.parse(task.startedAt)) / 60_000)) : 0;
  const tracked = (task?.loggedMinutes ?? 0) + timerMin;
  const dur = task && effectiveDuration(task);
  const pr = task && effectivePriority(task);
  const hue = task ? bubbleHue(task, now) : "green";
  const guessed = task && (!task.durationMin || !task.priority) && task.aiEstimate;

  return (
    <Sheet open={!!task} onClose={onClose} title={task?.title ?? ""}>
      {task && (
        <div className={`space-y-5 hue-${hue}`}>
          <div className="flex items-center gap-2">
            <span className="hue-badge">
              <span className="hue-dot h-2 w-2 rounded-full" /> {HUE_META[hue].label}
            </span>
            <span className="text-xs text-muted">{HUE_META[hue].hint}</span>
          </div>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted"><Clock className="h-4 w-4" />
              <span className="text-foreground">Due {formatDeadline(task.deadline, now)}</span></div>
            <div className="flex items-center gap-2 text-muted"><Flag className="h-4 w-4" />
              <span className="text-foreground">
                {pr ? pr[0].toUpperCase() + pr.slice(1) : "No"} priority
                {dur ? ` · ${dur} min` : " · standard size"}
                {guessed ? " (AI estimate)" : ""}
              </span></div>
            {task.aiEstimate?.reasoning && (
              <div className="flex items-start gap-2 text-muted"><Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{task.aiEstimate.reasoning}</span></div>
            )}
          </dl>

          <TimeLogger
            key={task.id}
            task={task}
            total={dur || undefined}
            timerMin={timerMin}
            onLogTime={onLogTime}
            onStartTimer={onStartTimer}
            onStopTimer={onStopTimer}
          />

          <section className="space-y-2">
            <p className="flex items-center gap-2 text-xs text-muted"><Repeat className="h-3.5 w-3.5" /> Repeat</p>
            <RecurrencePicker
              key={task.id}
              value={task.recurrence ?? null}
              anchorDow={new Date(task.deadline).getDay()}
              onChange={(r) => void onSetRecurrence(task, r)}
            />
          </section>

          <label className="block text-xs text-muted">
            How long did it take? (optional, min)
            <input
              key={task.id}
              type="number" inputMode="numeric" min={1} max={1440} value={actual}
              onChange={(e) => setActual(e.target.value)}
              placeholder={tracked > 0 ? `${tracked} tracked` : dur ? `about ${dur}` : "e.g. 45"}
              className="glass mt-1 w-full rounded-full px-4 py-2 text-sm text-foreground outline-none placeholder:text-muted focus:border-[rgb(var(--glow-a))]"
            />
            <span className="mt-1 block">Used to estimate similar tasks next time.</span>
          </label>

          <div className="flex gap-3">
            <button disabled={busy} onClick={() => {
                const n = Number(actual);
                const value = actual && Number.isFinite(n) && n >= 1 ? Math.min(1440, Math.round(n)) : undefined;
                setActual("");
                void run((t) => onComplete(t, value));
              }}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
              <Check className="h-4 w-4" /> Complete
            </button>
            <button disabled={busy} onClick={() => run(onDelete)} aria-label="Delete bubble"
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
      setError(e instanceof Error ? e.message : "Couldn't save your time.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="glass space-y-3 rounded-2xl p-4">
      <div>
        <p className="text-sm">
          {total
            ? `${logged} / ${total} min spent · ${remaining} min remaining`
            : `${logged} min spent`}
        </p>
        {total && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar"
            aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: "rgb(var(--c))" }} />
          </div>
        )}
        {total && logged > total && (
          <p className="mt-1 text-xs text-muted">Over the estimate by {logged - total} min.</p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted">{task.startedAt ? `Timer running · ${timerMin} min` : "Working on it now?"}</span>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setError(null);
            setSaving(true);
            try { await (task.startedAt ? onStopTimer(task) : onStartTimer(task)); }
            catch { setError("Couldn't update the timer."); }
            finally { setSaving(false); }
          }}
          className="flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
        >
          {task.startedAt ? <><Square className="h-3 w-3 fill-current" /> Stop</> : <><Play className="h-3 w-3 fill-current" /> Start timer</>}
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
          if (!Number.isInteger(n) || n < 1 || n > 1440) return setError("Enter a whole number of minutes (1–1440).");
          void log(n);
        }}
      >
        <input type="number" inputMode="numeric" min={1} max={1440} value={value}
          onChange={(e) => setValue(e.target.value)} placeholder="Minutes spent"
          aria-label="Minutes spent"
          className="glass min-w-0 flex-1 rounded-full px-4 py-2 text-sm outline-none placeholder:text-muted focus:border-[rgb(var(--glow-a))]" />
        <button type="submit" disabled={saving || !value}
          className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save
        </button>
      </form>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      <p className="text-xs text-muted">Logging time only shrinks the bubble. It never changes your schedule.</p>
    </section>
  );
}
