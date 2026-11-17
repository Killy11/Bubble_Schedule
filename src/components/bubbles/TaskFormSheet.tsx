"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { MicButton } from "@/components/MicButton";
import { Sheet } from "@/components/Sheet";
import { RecurrencePicker } from "./RecurrencePicker";
import type { NewTaskInput } from "@/hooks/useTasks";
import { describeSuggestion, suggestDuration } from "@/lib/history";
import type { HistoryRecord, Priority, Recurrence } from "@/types";

const field =
  "glass w-full rounded-2xl px-4 py-2.5 text-sm outline-none transition focus:border-[rgb(var(--glow-a))] placeholder:text-muted";

function defaultDeadline(): string {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function TaskFormSheet({
  open,
  onClose,
  onSubmit,
  history,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: NewTaskInput) => Promise<void>;
  history: readonly HistoryRecord[];
}) {
  return (
    <Sheet open={open} onClose={onClose} title="New bubble">
      {/* Remounts on each open, so the form resets and gets a fresh default deadline. */}
      {open && <Form onClose={onClose} onSubmit={onSubmit} history={history} />}
    </Sheet>
  );
}

function Form({
  onClose,
  onSubmit,
  history,
}: {
  onClose: () => void;
  onSubmit: (i: NewTaskInput) => Promise<void>;
  history: readonly HistoryRecord[];
}) {
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [duration, setDuration] = useState("");
  const [durationTouched, setDurationTouched] = useState(false);
  const [priority, setPriority] = useState<Priority | "">("");
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill the duration from similar tasks the user finished before, until they type their own.
  const suggestion = useMemo(() => suggestDuration(title, history), [title, history]);
  const shownDuration = durationTouched ? duration : suggestion ? String(suggestion.minutes) : "";
  const anchorDow = new Date(deadline).getDay();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const when = new Date(deadline);
    if (!title.trim()) return setError("Give your bubble a title.");
    if (Number.isNaN(when.getTime())) return setError("Pick a deadline.");
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        title,
        deadline: when.toISOString(),
        durationMin: shownDuration ? Math.max(5, Math.min(480, Number(shownDuration))) : undefined,
        priority: priority || undefined,
        recurrence: recurrence ?? undefined,
      });
      onClose();
    } catch {
      setError("Couldn't save the bubble. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-xs text-muted">
        <span className="flex justify-between">
          <span>Title *</span>
          <span aria-live="polite">{title.length}/100</span>
        </span>
        <div className="mt-1 flex items-center gap-2">
          <input autoFocus required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value.slice(0, 100))}
            placeholder="Type or tap the mic: “Write project report”" className={`${field} min-w-0 flex-1`} />
          <MicButton value={title} onChange={(t) => setTitle(t.slice(0, 100))} size="sm" />
        </div>
      </label>
      <label className="block text-xs text-muted">
        Deadline *
        <input required type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)}
          className={`${field} mt-1`} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-muted">
          Duration (min)
          <input type="number" inputMode="numeric" min={5} max={480} step={5} value={shownDuration}
            onChange={(e) => { setDuration(e.target.value); setDurationTouched(true); }}
            placeholder="AI will guess" className={`${field} mt-1`} />
        </label>
        <label className="block text-xs text-muted">
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")}
            className={`${field} mt-1`}>
            <option value="">AI will guess</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
      {suggestion && !durationTouched && (
        <p className="-mt-1 text-xs text-muted">{describeSuggestion(suggestion)}. Edit it if you like.</p>
      )}
      <div className="text-xs text-muted">
        <span className="mb-1 block">Repeat</span>
        <RecurrencePicker value={recurrence} onChange={setRecurrence} anchorDow={anchorDow} />
      </div>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Add bubble
      </button>
    </form>
  );
}
