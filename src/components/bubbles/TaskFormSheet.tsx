"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import type { NewTaskInput } from "@/hooks/useTasks";
import type { Priority } from "@/types";

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
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: NewTaskInput) => Promise<void>;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="New bubble">
      {/* Remounts on each open, so the form resets and gets a fresh default deadline. */}
      {open && <Form onClose={onClose} onSubmit={onSubmit} />}
    </Sheet>
  );
}

function Form({ onClose, onSubmit }: { onClose: () => void; onSubmit: (i: NewTaskInput) => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline);
  const [duration, setDuration] = useState("");
  const [priority, setPriority] = useState<Priority | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        durationMin: duration ? Math.max(5, Math.min(480, Number(duration))) : undefined,
        priority: priority || undefined,
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
        <input autoFocus required maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Write project report" className={`${field} mt-1`} />
      </label>
      <label className="block text-xs text-muted">
        Deadline *
        <input required type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)}
          className={`${field} mt-1`} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-xs text-muted">
          Duration (min)
          <input type="number" inputMode="numeric" min={5} max={480} step={5} value={duration}
            onChange={(e) => setDuration(e.target.value)} placeholder="AI will guess" className={`${field} mt-1`} />
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
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <button type="submit" disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Add bubble
      </button>
    </form>
  );
}
