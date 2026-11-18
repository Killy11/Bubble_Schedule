"use client";

import { useState } from "react";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useLang } from "@/context/LanguageProvider";
import { Sheet } from "@/components/Sheet";
import { formatDuration } from "@/lib/subtasks";
import type { Task } from "@/types";

/** Finished tasks: bring one back, delete it for good, or clear the lot. */
export function CompletedSheet({
  open,
  tasks,
  onClose,
  onRestore,
  onDelete,
  onClearAll,
}: {
  open: boolean;
  tasks: Task[];
  onClose: () => void;
  onRestore: (t: Task) => Promise<void>;
  onDelete: (t: Task) => Promise<void>;
  onClearAll: () => Promise<void>;
}) {
  const { t, lang } = useLang();
  const [confirming, setConfirming] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch {
      setError(t("Something went wrong. Please try again."));
    } finally {
      setBusyId(null);
      setConfirming(false);
    }
  }
  const close = () => {
    setConfirming(false);
    setError(null);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={t("Completed")}>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted">{t("Nothing completed yet")}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">{tasks.length}</p>
            {confirming ? (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-muted">{t("Delete all?")}</span>
                <button type="button" disabled={busyId === "all"} onClick={() => run("all", onClearAll)}
                  className="flex items-center gap-1 rounded-full bg-red-500 px-3 py-1.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60">
                  {busyId === "all" && <Loader2 className="h-3 w-3 animate-spin" />} {t("Delete")}
                </button>
                <button type="button" onClick={() => setConfirming(false)}
                  className="rounded-full px-2 py-1.5 text-muted transition hover:text-foreground">{t("Cancel")}</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirming(true)}
                className="rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-red-500">
                {t("Clear all")}
              </button>
            )}
          </div>
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="glass flex items-center gap-3 rounded-2xl p-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">{task.title}</p>
                  <p className="text-xs text-muted">
                    {task.completedAt
                      ? new Date(task.completedAt).toLocaleString(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                      : t("Completed")}
                    {task.loggedMinutes > 0 && ` · ${formatDuration(task.loggedMinutes, t)}`}
                  </p>
                </div>
                <button type="button" disabled={busyId !== null} onClick={() => run(task.id, () => onRestore(task))}
                  className="flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50">
                  {busyId === task.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} {t("Restore")}
                </button>
                <button type="button" disabled={busyId !== null} onClick={() => run(task.id, () => onDelete(task))}
                  aria-label={`${t("Delete")}: ${task.title}`}
                  className="rounded-full p-2 text-muted transition hover:text-red-500 disabled:opacity-50">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
