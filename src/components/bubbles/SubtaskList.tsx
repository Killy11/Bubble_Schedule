"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, ListTree, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { formatDuration, formatWindow, MAX_SUBTASKS, newSubtaskId, progressLabel, subtaskProgress } from "@/lib/subtasks";
import type { Subtask, Task } from "@/types";

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const input =
  "glass min-w-0 rounded-xl px-3 py-2 text-sm text-foreground outline-none transition focus:border-[rgb(var(--glow-a))] placeholder:text-muted";

/** A few droplets for the mini-pop when a part is checked off. */
function MiniBurst() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {Array.from({ length: 7 }, (_, i) => {
        const a = (i / 7) * Math.PI * 2;
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full"
            style={{ background: "rgb(var(--c))", boxShadow: "0 0 6px rgb(var(--c) / 0.8)", marginLeft: -3, marginTop: -3 }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(a) * 18, y: Math.sin(a) * 18, opacity: 0, scale: 0.3 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          />
        );
      })}
    </span>
  );
}

export function SubtaskList({
  task,
  now,
  splitting,
  onToggle,
  onSave,
  onSplit,
}: {
  task: Task;
  now: number;
  splitting: boolean;
  onToggle: (t: Task, sub: Subtask, checked: boolean) => Promise<void>;
  onSave: (t: Task, subs: Subtask[]) => Promise<void>;
  onSplit: (t: Task) => void;
}) {
  const subs = task.subtasks ?? [];
  const progress = subtaskProgress(task);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sorted = subs
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.scheduledStart ?? "9").localeCompare(b.s.scheduledStart ?? "9") || a.i - b.i)
    .map((x) => x.s);

  async function save(next: Subtask[]) {
    setError(null);
    try {
      await onSave(task, next);
      return true;
    } catch {
      setError("Couldn't save your changes. Please try again.");
      return false;
    }
  }

  return (
    <section className="glass space-y-3 rounded-2xl p-4" aria-label="Parts">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium"><ListTree className="h-4 w-4 text-muted" /> Parts</p>
          {progress && <p className="mt-0.5 text-xs text-muted">{progressLabel(task, now)}</p>}
        </div>
        <button
          type="button"
          disabled={splitting}
          onClick={() => onSplit(task)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-60"
        >
          {splitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {splitting ? "Planning…" : subs.length ? "Re-split with AI" : "Split into subtasks with AI"}
        </button>
      </div>

      {progress && (
        <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0}
          aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${(progress.done / progress.total) * 100}%`, background: "rgb(var(--c))" }} />
        </div>
      )}

      {subs.length === 0 && !splitting && (
        <p className="text-xs text-muted">
          Big tasks work better in small sessions. Split this one and every part gets its own time slot.
        </p>
      )}

      <ul className="space-y-2">
        {sorted.map((s) =>
          editingId === s.id ? (
            <EditRow
              key={s.id}
              sub={s}
              deadline={task.deadline}
              onCancel={() => setEditingId(null)}
              onSave={async (u) => {
                if (await save(subs.map((x) => (x.id === s.id ? u : x)))) setEditingId(null);
              }}
            />
          ) : (
            <Row
              key={s.id}
              sub={s}
              now={now}
              onToggle={(checked) => onToggle(task, s, checked)}
              onEdit={() => { setAdding(false); setEditingId(s.id); }}
              onRemove={() => void save(subs.filter((x) => x.id !== s.id))}
            />
          ),
        )}
      </ul>

      {adding ? (
        <EditRow
          sub={{ id: newSubtaskId(), title: "", durationMinutes: 30, completed: false }}
          deadline={task.deadline}
          isNew
          onCancel={() => setAdding(false)}
          onSave={async (u) => {
            if (await save([...subs, u])) setAdding(false);
          }}
        />
      ) : (
        subs.length < MAX_SUBTASKS && (
          <button type="button" onClick={() => { setEditingId(null); setAdding(true); }}
            className="flex items-center gap-1.5 text-xs text-muted transition hover:text-foreground">
            <Plus className="h-3.5 w-3.5" /> Add a part
          </button>
        )
      )}
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    </section>
  );
}

function Row({
  sub,
  now,
  onToggle,
  onEdit,
  onRemove,
}: {
  sub: Subtask;
  now: number;
  onToggle: (checked: boolean) => Promise<void>;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [pops, setPops] = useState(0);
  const [busy, setBusy] = useState(false);
  const missed = !sub.completed && !!sub.scheduledEnd && Date.parse(sub.scheduledEnd) < now;

  async function toggle() {
    const checked = !sub.completed;
    setBusy(true);
    if (checked) setPops((n) => n + 1);
    try {
      await onToggle(checked);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex items-start gap-3">
      <button
        type="button"
        role="checkbox"
        aria-checked={sub.completed}
        aria-label={`${sub.completed ? "Mark not done" : "Mark done"}: ${sub.title}`}
        disabled={busy}
        onClick={toggle}
        className={`relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
          sub.completed ? "border-transparent bg-[rgb(var(--c))] text-background" : "border-line hover:border-foreground/50"
        }`}
      >
        {pops > 0 && sub.completed && <MiniBurst key={pops} />}
        {sub.completed && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: [0, 1.35, 1] }} transition={{ duration: 0.3 }}>
            <Check className="h-3 w-3" strokeWidth={3} />
          </motion.span>
        )}
      </button>
      <div className={`min-w-0 flex-1 ${sub.completed ? "opacity-55" : ""}`}>
        <div className="flex items-start justify-between gap-2">
          <p className={`break-words text-sm ${sub.completed ? "line-through" : ""}`}>{sub.title}</p>
          <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
            {formatDuration(sub.durationMinutes)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className={`text-xs ${missed ? "text-red-500" : "text-muted"}`}>
            {formatWindow(sub, now)}{missed ? " · missed" : ""}
          </p>
          <span className="flex shrink-0 gap-0.5">
            <button type="button" onClick={onEdit} aria-label={`Edit ${sub.title}`}
              className="rounded-full p-1 text-muted transition hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={onRemove} aria-label={`Remove ${sub.title}`}
              className="rounded-full p-1 text-muted transition hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
          </span>
        </div>
      </div>
    </li>
  );
}

function EditRow({
  sub,
  deadline,
  isNew,
  onSave,
  onCancel,
}: {
  sub: Subtask;
  deadline: string;
  isNew?: boolean;
  onSave: (s: Subtask) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(sub.title);
  const [minutes, setMinutes] = useState(String(sub.durationMinutes));
  const [start, setStart] = useState(toLocalInput(sub.scheduledStart));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const min = Math.round(Number(minutes));
    if (!title.trim()) return setError("Give this part a title.");
    if (!Number.isFinite(min) || min < 5 || min > 480) return setError("Duration must be 5–480 minutes.");
    let scheduled: Pick<Subtask, "scheduledStart" | "scheduledEnd"> = {};
    if (start) {
      const t = new Date(start).getTime();
      if (Number.isNaN(t)) return setError("Pick a valid start time.");
      if (t + min * 60_000 >= Date.parse(deadline)) return setError("This session must end before the task's due date.");
      scheduled = { scheduledStart: new Date(t).toISOString(), scheduledEnd: new Date(t + min * 60_000).toISOString() };
    }
    // A time typed in by hand is kept: automatic re-planning works around it instead of moving it.
    const pinned = !!start && (isNew || start !== toLocalInput(sub.scheduledStart) || !!sub.pinned);
    setBusy(true);
    setError(null);
    await onSave({
      id: sub.id, title: title.trim().slice(0, 100), durationMinutes: min, completed: sub.completed,
      ...(pinned ? { pinned: true } : {}), ...scheduled,
    });
    setBusy(false);
  }

  return (
    <li>
      <form onSubmit={submit} className="space-y-2 rounded-xl border border-line p-2.5">
        <input autoFocus value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)}
          placeholder="What to do in this session" aria-label="Part title" className={`${input} w-full`} />
        <div className="flex flex-wrap gap-2">
          <input type="number" inputMode="numeric" min={5} max={480} step={5} value={minutes}
            onChange={(e) => setMinutes(e.target.value)} aria-label="Duration in minutes" className={`${input} w-24`} />
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
            aria-label="Start time" className={`${input} min-w-0 flex-1`} />
        </div>
        <p className="text-[11px] text-muted">The end time follows from the duration. Leave the start empty to let the planner choose it. A time you set stays put.</p>
        {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy}
            className="flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-60">
            {busy && <Loader2 className="h-3 w-3 animate-spin" />} {isNew ? "Add part" : "Save"}
          </button>
          <button type="button" onClick={onCancel}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-foreground">
            <X className="h-3 w-3" /> Cancel
          </button>
        </div>
      </form>
    </li>
  );
}
