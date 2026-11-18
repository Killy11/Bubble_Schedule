"use client";

import { useState } from "react";
import { CalendarClock, CalendarOff, Loader2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { useLang } from "@/context/LanguageProvider";
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

/** Give a task a new deadline, or remove its deadline. The planner then gives it a new slot. */
export function RescheduleSheet({
  task,
  now,
  onClose,
  onReschedule,
}: {
  task: Task | null;
  now: number;
  onClose: () => void;
  /** `null` = no deadline. */
  onReschedule: (t: Task, deadlineIso: string | null) => Promise<void>;
}) {
  const { t, lang } = useLang();
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(ms: number | null) {
    if (!task) return;
    if (ms !== null && ms <= now) return setError(t("Pick a time in the future."));
    setBusy(true);
    setError(null);
    try {
      await onReschedule(task, ms === null ? null : new Date(ms).toISOString());
      setCustom("");
      onClose();
    } catch {
      setError(t("Couldn't save. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  const presets = [
    { label: t("Tomorrow evening"), ms: evening(now, 1), primary: true },
    { label: t("In 2 hours"), ms: now + 2 * 3_600_000 },
    { label: t("In 2 days"), ms: evening(now, 2) },
    { label: t("In a week"), ms: evening(now, 7) },
  ];

  return (
    <Sheet open={!!task} onClose={onClose} title={t("Reschedule")}>
      {task && (
        <div className="space-y-4">
          <div>
            <p className="break-words text-sm font-medium">{task.title}</p>
            {task.deadline && Date.parse(task.deadline) < now && (
              <p className="text-xs text-muted">{formatOverdue(task.deadline, now, t)}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={busy}
                onClick={() => apply(p.ms)}
                className={`rounded-2xl px-3 py-2.5 text-left text-sm transition disabled:opacity-60 ${
                  p.primary ? "bg-foreground text-background" : "glass text-foreground hover:brightness-125"
                }`}
              >
                <span className="block font-medium">{p.label}</span>
                <span className={`block text-xs ${p.primary ? "opacity-70" : "text-muted"}`}>
                  {new Date(p.ms).toLocaleString(lang, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void apply(new Date(custom).getTime());
            }}
          >
            <input type="datetime-local" value={custom} min={toLocalInput(now)} onChange={(e) => setCustom(e.target.value)}
              aria-label={t("Deadline")}
              className="glass min-w-0 flex-1 rounded-full px-4 py-2 text-sm outline-none focus:border-[rgb(var(--glow-a))]" />
            <button type="submit" disabled={busy || !custom}
              className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-50">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />} {t("Set")}
            </button>
          </form>
          <button type="button" disabled={busy} onClick={() => apply(null)}
            className="glass flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm text-muted transition hover:text-foreground disabled:opacity-60">
            <CalendarOff className="h-4 w-4" /> {t("No deadline")}
          </button>
          {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
