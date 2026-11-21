"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, ListTree, Loader2, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useLang } from "@/context/LanguageProvider";
import { DurationFields, snap5 } from "@/components/DurationFields";
import { totalMinutes } from "@/lib/duration";
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
  onSplit: (t: Task, parts?: number) => void;
}) {
  const [partCount, setPartCount] = useState("");
  const subs = task.subtasks ?? [];
  const progress = subtaskProgress(task);
  const { t, lang } = useLang();
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
      setError(t("Couldn't save. Please try again."));
      return false;
    }
  }

  return (
    <section className="glass space-y-3 rounded-2xl p-4" aria-label={t("Parts")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium"><ListTree className="h-4 w-4 text-muted" /> {t("Parts")}</p>
          {progress && <p className="mt-0.5 text-xs text-muted">{progressLabel(task, now, t, lang)}</p>}
        </div>
        <button
          type="button"
          disabled={splitting}
          onClick={() => {
            const n = Math.round(Number(partCount));
            onSplit(task, partCount && n >= 2 && n <= MAX_SUBTASKS ? n : undefined);
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-60"
        >
          {splitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {splitting ? t("Planning…") : subs.length ? t("Re-split") : t("Split with AI")}
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs text-muted">
        {t("Parts")}
        <input type="number" inputMode="numeric" min={2} max={MAX_SUBTASKS} value={partCount}
          onChange={(e) => setPartCount(e.target.value)} placeholder={t("auto")} aria-label={t("Number of parts")}
          className="glass w-16 rounded-lg px-2 py-1 text-xs text-foreground outline-none placeholder:text-muted focus:border-[rgb(var(--glow-a))]" />
      </label>

      {progress && (
        <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0}
          aria-valuemax={progress.total} aria-valuenow={progress.done}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${(progress.done / progress.total) * 100}%`, background: "rgb(var(--c))" }} />
        </div>
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
            <Plus className="h-3.5 w-3.5" /> {t("Add part")}
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
  const { t, lang } = useLang();
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
        aria-label={`${sub.completed ? t("Mark as not done") : t("Mark complete")}: ${sub.title}`}
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
            {formatDuration(sub.durationMinutes, t)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className={`text-xs ${missed ? "text-red-500" : "text-muted"}`}>
            {formatWindow(sub, now, t, lang)}{missed ? ` · ${t("missed")}` : ""}
          </p>
          <span className="flex shrink-0 gap-0.5">
            <button type="button" onClick={onEdit} aria-label={`${t("Edit")}: ${sub.title}`}
              className="rounded-full p-1 text-muted transition hover:text-foreground"><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={onRemove} aria-label={`${t("Delete")}: ${sub.title}`}
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
  deadline?: string;
  isNew?: boolean;
  onSave: (s: Subtask) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLang();
  const [title, setTitle] = useState(sub.title);
  const [hours, setHours] = useState(() => String(Math.floor(snap5(sub.durationMinutes) / 60)));
  const [minutes, setMinutes] = useState(() => String(snap5(sub.durationMinutes) % 60));
  const [start, setStart] = useState(toLocalInput(sub.scheduledStart));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const min = totalMinutes(hours, minutes) ?? 0;
    if (!title.trim()) return setError(t("Give your bubble a title."));
    if (!Number.isFinite(min) || min < 1) return setError(t("Duration: at least 1 min"));
    let scheduled: Pick<Subtask, "scheduledStart" | "scheduledEnd"> = {};
    if (start) {
      const at = new Date(start).getTime();
      if (Number.isNaN(at)) return setError(t("Pick a start time."));
      if (deadline && at + min * 60_000 >= Date.parse(deadline)) return setError(t("Must end before the deadline."));
      scheduled = { scheduledStart: new Date(at).toISOString(), scheduledEnd: new Date(at + min * 60_000).toISOString() };
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
          placeholder={t("What to do")} aria-label={t("Title")} className={`${input} w-full`} />
        <div className="flex flex-wrap gap-2">
          <div className="w-44 shrink-0">
            <DurationFields hours={hours} minutes={minutes} onHours={setHours} onMinutes={setMinutes} hint={false} allowBlank={false} />
          </div>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)}
            aria-label={t("Start time")} className={`${input} min-w-0 flex-1`} />
        </div>
        {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy}
            className="flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-60">
            {busy && <Loader2 className="h-3 w-3 animate-spin" />} {isNew ? t("Add part") : t("Save")}
          </button>
          <button type="button" onClick={onCancel}
            className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-foreground">
            <X className="h-3 w-3" /> {t("Cancel")}
          </button>
        </div>
      </form>
    </li>
  );
}
