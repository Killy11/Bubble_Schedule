"use client";

import { useState } from "react";
import { Loader2, Pin } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import type { ScheduleBlock } from "@/types";

const pad = (n: number) => String(n).padStart(2, "0");
const dateOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const field = "glass w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/30";

/** Edit one block's day/start/end. Saving pins it, so the AI plans everything else around it. */
export function BlockEditSheet({
  block,
  others,
  onClose,
  onSave,
  onShowTask,
}: {
  block: ScheduleBlock | null;
  /** The other (not done) blocks, to refuse overlaps. */
  others: ScheduleBlock[];
  onClose: () => void;
  onSave: (id: string, start: string, end: string, pinned: boolean) => Promise<void>;
  /** Optional: open the task's detail sheet (shown when the sheet was opened from a bubble). */
  onShowTask?: () => void;
}) {
  return (
    <Sheet open={!!block} onClose={onClose} title="Edit time">
      {/* key: fresh form state for every block */}
      {block && <Form key={block.id} {...{ block, others, onClose, onSave, onShowTask }} />}
    </Sheet>
  );
}

function Form({
  block,
  others,
  onClose,
  onSave,
  onShowTask,
}: {
  block: ScheduleBlock;
  others: ScheduleBlock[];
  onClose: () => void;
  onSave: (id: string, start: string, end: string, pinned: boolean) => Promise<void>;
  onShowTask?: () => void;
}) {
  const s0 = new Date(block.start);
  const e0 = new Date(block.end);
  const [date, setDate] = useState(dateOf(s0));
  const [start, setStart] = useState(timeOf(s0));
  const [end, setEnd] = useState(timeOf(e0));
  const [pinned, setPinned] = useState(!!block.isPinned);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s = new Date(`${date}T${start}`);
  const e = new Date(`${date}T${end}`);
  const problem =
    !date || !start || !end || Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) ? "Pick a day and both times."
    : e <= s ? "The end must be after the start."
    : e.getTime() - s.getTime() < 5 * 60_000 ? "A block must be at least 5 minutes."
    : others.some((o) => s < new Date(o.end) && e > new Date(o.start)) ? "That overlaps another block."
    : null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="break-words text-sm font-medium">{block.title}</p>
      <label className="block space-y-1 text-xs text-muted">
        Day
        <input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} className={field} />
      </label>
      <div className="flex gap-3">
        <label className="block flex-1 space-y-1 text-xs text-muted">
          Start
          <input type="time" value={start} onChange={(ev) => setStart(ev.target.value)} className={field} />
        </label>
        <label className="block flex-1 space-y-1 text-xs text-muted">
          End
          <input type="time" value={end} onChange={(ev) => setEnd(ev.target.value)} className={field} />
        </label>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={pinned}
        onClick={() => setPinned((v) => !v)}
        className="glass flex w-full items-center gap-3 rounded-2xl p-3 text-left"
      >
        <Pin className={`h-4 w-4 shrink-0 ${pinned ? "text-foreground" : "text-muted"}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Pin this time</span>
          <span className="block text-xs text-muted">
            {pinned
              ? "Locked: the AI will never move it and plans other tasks around it."
              : "Not locked: the AI may still move it when it reschedules."}
          </span>
        </span>
        <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${pinned ? "bg-foreground" : "bg-muted/40"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all ${pinned ? "left-[18px]" : "left-0.5"}`} />
        </span>
      </button>
      <p className="text-xs text-muted">Times outside your working hours are allowed.</p>
      {(problem || error) && (
        <p role="alert" className="text-xs text-red-500">{error ?? problem}</p>
      )}
      <div className="flex gap-2">
        {onShowTask && (
          <button
            disabled={busy}
            onClick={onShowTask}
            className="glass rounded-full px-4 py-3 text-sm font-medium transition hover:brightness-125 disabled:opacity-60"
          >
            Task details
          </button>
        )}
        <button
          disabled={busy || !!problem}
          onClick={() => run(() => onSave(block.id, s.toISOString(), e.toISOString(), pinned))}
          className="flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {pinned ? "Save & pin" : "Save"}
        </button>
      </div>
    </div>
  );
}
