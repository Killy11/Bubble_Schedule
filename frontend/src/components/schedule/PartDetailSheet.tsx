"use client";

import { Check, Circle, Clock, Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { Sheet } from "@/components/Sheet";
import { bubbleHue, HUE_META } from "@/lib/bubbles/urgency";
import { useLang } from "@/context/LanguageProvider";
import { formatDuration, formatWindow, subtaskProgress } from "@/lib/subtasks";
import { formatDeadline } from "@/lib/time";
import type { Subtask, Task } from "@/types";

/** One scheduled step, with the context of the bigger task it belongs to. */
export function PartDetailSheet({
  task,
  sub,
  now,
  onClose,
  onToggle,
  onEditParent,
}: {
  task: Task | null;
  sub: Subtask | null;
  now: number;
  onClose: () => void;
  onToggle: (t: Task, s: Subtask) => Promise<void>;
  onEditParent: (t: Task) => void;
}) {
  const { t, lang } = useLang();
  const open = !!task && !!sub;
  const [busy, setBusy] = useState(false);
  const hue = task ? bubbleHue(task, now) : "green";
  const progress = task ? subtaskProgress(task) : null;
  const siblings = task
    ? [...(task.subtasks ?? [])]
    : [];

  return (
    <Sheet open={open} onClose={onClose} title={sub?.title ?? ""}>
      {task && sub && (
        <div className={`space-y-5 hue-${hue}`}>
          <section className="space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted" />
              <span>{formatWindow(sub, now, t, lang)}</span>
              <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{formatDuration(sub.durationMinutes, t)}</span>
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onToggle(task, sub);
                } finally {
                  setBusy(false);
                }
              }}
              className={`flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition hover:opacity-90 disabled:opacity-60 ${
                sub.completed ? "glass text-foreground" : "bg-foreground text-background"
              }`}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {sub.completed ? t("Mark as not done") : t("Mark complete")}
            </button>
          </section>

          <section className="glass space-y-3 rounded-2xl p-4" aria-label={t("Part of")}>
            <div>
              <p className="text-xs text-muted">{t("Part of")}</p>
              <p className="break-words text-base font-semibold">{task.title}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="hue-badge"><span className="hue-dot h-2 w-2 rounded-full" /> {t(HUE_META[hue].label)}</span>
                <span>· {formatDeadline(task.deadline, now, t, lang)}</span>
              </p>
            </div>

            {progress && (
              <div>
                <p className="text-sm">{progress.done} / {progress.total}</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar"
                  aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(progress.done / progress.total) * 100}%`, background: "rgb(var(--c))" }} />
                </div>
              </div>
            )}

            <ol className="space-y-2">
              {siblings.map((s, i) => (
                <li key={s.id} className={`flex items-start gap-2 text-sm ${s.id === sub.id ? "font-medium" : ""}`}>
                  {s.completed ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--c))]" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" />}
                  <span className="min-w-0 flex-1">
                    <span className={`break-words ${s.completed ? "text-muted line-through" : ""}`}>
                      {i + 1}. {s.title}
                    </span>
                    <span className="block text-xs text-muted">{formatWindow(s, now, t, lang)} · {formatDuration(s.durationMinutes, t)}</span>
                  </span>
                  {s.id === sub.id && <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px]">{t("this step")}</span>}
                </li>
              ))}
            </ol>

            <button
              type="button"
              onClick={() => onEditParent(task)}
              className="glass flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-sm text-muted transition hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" /> {t("Edit")}
            </button>
          </section>
        </div>
      )}
    </Sheet>
  );
}
