"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { formatDeadline } from "@/lib/time";
import type { Task } from "@/types";

const HOUR = 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Expired bubbles: bring one back with a new deadline, or remove it for good. */
export function ExpiredSheet({
  open,
  tasks,
  now,
  onClose,
  onReschedule,
  onDelete,
}: {
  open: boolean;
  tasks: Task[];
  now: number;
  onClose: () => void;
  onReschedule: (t: Task, deadlineIso: string) => Promise<void>;
  onDelete: (t: Task) => Promise<void>;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Expired bubbles">
      {tasks.length === 0 ? (
        <p className="text-sm text-muted">Nothing has expired. 🎉</p>
      ) : (
        <ul className="space-y-3">
          {tasks.map((t) => (
            <Row key={t.id} task={t} now={now} onReschedule={onReschedule} onDelete={onDelete} />
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function Row({
  task,
  now,
  onReschedule,
  onDelete,
}: {
  task: Task;
  now: number;
  onReschedule: (t: Task, iso: string) => Promise<void>;
  onDelete: (t: Task) => Promise<void>;
}) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }
  const at = (ms: number) => run(() => onReschedule(task, new Date(ms).toISOString()));
  // Same time of day tomorrow as the original deadline (or now + 24 h when that's still in the past).
  const tomorrow = (() => {
    const d = new Date(task.deadline);
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    t.setHours(d.getHours(), d.getMinutes(), 0, 0);
    return t.getTime();
  })();

  return (
    <li className="glass space-y-3 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-medium">{task.title}</p>
          <p className="text-xs text-muted">
            Was due {new Date(task.deadline).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(() => onDelete(task))}
          aria-label={`Delete ${task.title}`}
          className="shrink-0 rounded-full p-1.5 text-muted transition hover:text-red-500 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => at(now + HOUR)}
          className="glass rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-50">
          In 1 hour
        </button>
        <button type="button" disabled={busy} onClick={() => at(tomorrow)}
          className="glass rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-50">
          Tomorrow, {formatDeadline(new Date(tomorrow).toISOString(), now).replace(/^Tomorrow /, "")}
        </button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const ms = new Date(custom).getTime();
          if (Number.isNaN(ms) || ms <= now) return setError("Pick a time in the future.");
          void at(ms);
        }}
      >
        <input type="datetime-local" value={custom} min={toLocalInput(now)} onChange={(e) => setCustom(e.target.value)}
          aria-label="New deadline"
          className="glass min-w-0 flex-1 rounded-full px-4 py-2 text-sm outline-none focus:border-[rgb(var(--glow-a))]" />
        <button type="submit" disabled={busy || !custom}
          className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Reschedule
        </button>
      </form>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    </li>
  );
}
