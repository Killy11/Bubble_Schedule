"use client";

import { useState } from "react";
import { CalendarClock, CheckCheck, Loader2 } from "lucide-react";
import { Sheet } from "@/components/Sheet";
import { useLang } from "@/context/LanguageProvider";
import { formatOverdue } from "@/lib/time";
import type { Task } from "@/types";

/** Tasks whose deadline passed. Each one can be marked as already done, or given a new deadline. */
export function OverdueSheet({
  open,
  tasks,
  now,
  onClose,
  onDone,
  onReschedule,
}: {
  open: boolean;
  tasks: Task[];
  now: number;
  onClose: () => void;
  /** "I already did this": moves the task straight to Completed. */
  onDone: (t: Task) => Promise<void>;
  onReschedule: (t: Task) => void;
}) {
  const { t } = useLang();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function done(task: Task) {
    setBusyId(task.id);
    setError(null);
    try {
      await onDone(task);
    } catch {
      setError(t("Something went wrong. Please try again."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("Overdue")}>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted">{t("Nothing overdue")}</p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id} className="glass space-y-2.5 rounded-2xl p-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-medium">{task.title}</p>
                <p className="text-xs text-red-500">
                  {task.deadline ? formatOverdue(task.deadline, now, t) : t("Overdue")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busyId !== null} onClick={() => done(task)}
                  className="flex items-center gap-1.5 rounded-full bg-foreground px-3.5 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50">
                  {busyId === task.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                  {t("I already did this")}
                </button>
                <button type="button" disabled={busyId !== null} onClick={() => onReschedule(task)}
                  className="glass flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs text-foreground transition hover:brightness-125 disabled:opacity-50">
                  <CalendarClock className="h-3.5 w-3.5" /> {t("Reschedule")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
    </Sheet>
  );
}
