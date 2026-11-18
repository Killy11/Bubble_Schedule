"use client";

import { motion } from "framer-motion";
import { Check, Minus, Pause, Pencil, Play, Plus } from "lucide-react";
import { useLang } from "@/context/LanguageProvider";
import { useSecondTick } from "@/hooks/useSecondTick";
import { formatClock, remainingMinutes, remainingMs, STEP_MIN } from "@/lib/remaining";
import { formatDuration } from "@/lib/subtasks";
import type { BubblePlacement } from "@/lib/bubbles/layout";
import type { Task } from "@/types";

const BAR_H = 40;
const GAP = 8;
const btn =
  "flex h-8 shrink-0 items-center justify-center rounded-full text-foreground transition hover:bg-foreground/10 disabled:opacity-40";

/**
 * Floating quick actions for the selected bubble: Done, −15m / time left / +15m, timer play-pause, Edit.
 * Anchored above the bubble (below it if there is no room) and clamped inside the canvas, so it never overflows.
 */
export function BubbleQuickBar({
  task,
  place,
  canvasW,
  canvasH,
  onComplete,
  onAdjust,
  onToggleTimer,
  onEdit,
}: {
  task: Task;
  place: BubblePlacement;
  canvasW: number;
  canvasH: number;
  onComplete: () => void;
  onAdjust: (delta: number) => void;
  onToggleTimer: () => void;
  onEdit: () => void;
}) {
  const { t } = useLang();
  const running = !!task.startedAt;
  const now = useSecondTick(running);
  const hasParts = !!task.subtasks?.length; // the time of a task with parts lives in its parts
  const width = Math.min(316, canvasW - 8);
  const left = Math.min(Math.max(4, place.x + place.d / 2 - width / 2), Math.max(4, canvasW - width - 4));
  const above = place.y - BAR_H - GAP;
  const top = above >= 4 ? above : Math.min(place.y + place.d + GAP, Math.max(4, canvasH - BAR_H - 4));
  const label = running ? formatClock(remainingMs(task, now)) : formatDuration(remainingMinutes(task), t);

  return (
    <motion.div
      data-keep
      role="toolbar"
      aria-label={task.title}
      initial={{ opacity: 0, scale: 0.9, y: above >= 4 ? 6 : -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
      className="glass absolute z-20 flex items-center justify-between gap-0.5 rounded-full bg-background/85 px-1 shadow-xl backdrop-blur-xl"
      style={{ left, top, width, height: BAR_H }}
    >
      <button type="button" onClick={onComplete} aria-label={t("Done")} className={`${btn} gap-1 bg-foreground px-3 text-xs font-medium !text-background hover:!bg-foreground/90`}>
        <Check className="h-4 w-4" /> <span className="hidden min-[400px]:inline">{t("Done")}</span>
      </button>
      {!hasParts && (
        <>
          <button type="button" onClick={() => onAdjust(-STEP_MIN)} aria-label={t("{n}m", { n: `−${STEP_MIN}` })} className={`${btn} w-8`}>
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[3.25rem] text-center text-xs tabular-nums" aria-live="off">{label}</span>
          <button type="button" onClick={() => onAdjust(STEP_MIN)} aria-label={t("{n}m", { n: `+${STEP_MIN}` })} className={`${btn} w-8`}>
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onToggleTimer} aria-label={running ? t("Pause") : t("Start timer")} aria-pressed={running} className={`${btn} w-8`}>
            {running ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
          </button>
        </>
      )}
      <button type="button" onClick={onEdit} aria-label={t("Edit")} title={t("Edit")} className={`${btn} w-8`}>
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}
