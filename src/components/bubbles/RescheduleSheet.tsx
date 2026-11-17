"use client";

import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { formatOverdue } from "@/lib/time";
import type { Task } from "@/types";

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Local 18:00, `days` days from today. */
const evening = (now: number, days: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  d.setHours(18, 0, 0, 0);
  return d.getTime();
};

/** Move a task's deadline forward. The planner then gives it a new slot. */
export function RescheduleSheet({
  task,
  now,
  onClose,
  onReschedule,
}: {
  task: Task | null;
  now: number;
  onClose: () => void;
  onReschedule: (t: Task, deadlineIso: string) => Promise<void>;
}) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function moveTo(ms: number) {
    if (!task) return;
    if (ms <= now) return setError("Pick a time in the future.");
    setBusy(true);
    setError(null);
    try {
      await onReschedule(task, new Date(ms).toISOString());
      setCustom("");
      onClose();
    } catch {
      setError("Couldn't reschedule. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const presets = [
    { label: "Tomorrow evening", sub: "18:00", ms: evening(now, 1), primary: true },
    { label: "In 2 hours", sub: "", ms: now + 2 * 3_600_000 },
    { label: "In 2 days", sub: "18:00", ms: evening(now, 2) },
    { label: "In a week", sub: "18:00", ms: evening(now, 7) },
  ];

  return (
    <Sheet open={!!task} onClose={onClose} title="Reschedule">
      {task && (
        <div className="space-y-4">
          <div>
            <p className="break-words text-sm font-medium">{task.title}</p>
            {Date.parse(task.deadline) < now && <p className="text-xs text-muted">{formatOverdue(task.deadline, now)}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={busy}
                onClick={() => moveTo(p.ms)}
                className={`rounded-2xl px-3 py-2.5 text-left text-sm transition disabled:opacity-60 ${
                  p.primary ? "bg-foreground text-background" : "glass text-foreground hover:brightness-125"
                }`}
              >
                <span className="block font-medium">{p.label}</span>
                <span className={`block text-xs ${p.primary ? "opacity-70" : "text-muted"}`}>
                  {new Date(p.ms).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void moveTo(new Date(custom).getTime());
            }}
          >
            <input type="datetime-local" value={custom} min={toLocalInput(now)} onChange={(e) => setCustom(e.target.value)}
              aria-label="New deadline"
              className="glass min-w-0 flex-1 rounded-full px-4 py-2 text-sm outline-none focus:border-[rgb(var(--glow-a))]" />
            <button type="submit" disabled={busy || !custom}
              className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} Set
            </button>
          </form>
          {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
