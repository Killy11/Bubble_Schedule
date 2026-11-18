"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Repeat } from "lucide-react";
import { Orb } from "@/components/Orb";
import { BubbleText } from "./BubbleText";
import { bubbleHue } from "@/lib/bubbles/urgency";
import { recurrenceLabel } from "@/lib/recurrence";
import { progressLabel, subtaskProgress } from "@/lib/subtasks";
import { formatDeadline } from "@/lib/time";
import { useLang } from "@/context/LanguageProvider";
import type { Task } from "@/types";
import type { BubblePlacement } from "@/lib/bubbles/layout";

const SPRING = { type: "spring", stiffness: 70, damping: 16, mass: 1 } as const;
/** Pop length; the dashboard waits this long before it writes the completion. */
export const POP_MS = 450;

const PARTICLES = 14;
// Fixed pseudo-random offsets, so the burst looks organic but renders purely.
const jitter = (i: number, salt: number) => ((i * 9301 + salt * 49297) % 233280) / 233280;

/** Glowing droplets flying out of the bubble in its own colour (via the `hue-*` class). */
function Burst({ d }: { d: number }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <motion.span
        className="absolute inset-0 rounded-full border-2"
        style={{ borderColor: "rgb(var(--c) / 0.8)" }}
        initial={{ scale: 0.9, opacity: 0.9 }}
        animate={{ scale: 1.6, opacity: 0 }}
        transition={{ duration: POP_MS / 1000, ease: "easeOut" }}
      />
      {Array.from({ length: PARTICLES }, (_, i) => {
        const angle = (i / PARTICLES) * Math.PI * 2 + jitter(i, 1) * 0.5;
        const dist = d * (0.55 + jitter(i, 2) * 0.35);
        const size = 5 + jitter(i, 3) * 7;
        return (
          <motion.span
            key={i}
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              background: "rgb(var(--c))",
              boxShadow: "0 0 10px 2px rgb(var(--c) / 0.7)",
            }}
            initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, scale: 0.2, opacity: 0 }}
            transition={{ duration: POP_MS / 1000, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}

export function Bubble({
  task,
  place,
  now,
  index,
  onOpen,
  popping = false,
}: {
  task: Task;
  place: BubblePlacement;
  now: number;
  index: number;
  onOpen: (id: string) => void;
  popping?: boolean;
}) {
  const reduced = useReducedMotion();
  const { t, lang } = useLang();
  const hue = bubbleHue(task, now);
  // Each bubble drifts on its own slow loop.
  const dur = 5 + (index % 5) * 1.3;
  const amp = 5 + (index % 3) * 2;
  const geometry = { x: place.x, y: place.y, width: place.d, height: place.d };
  const parts = subtaskProgress(task);
  const repeats = task.recurrence ? t(recurrenceLabel(task.recurrence)).toLowerCase() : null;

  return (
    <motion.div
      className={`absolute left-0 top-0 hue-${hue}`}
      initial={{ ...geometry, scale: 0, opacity: 0 }}
      // Position AND size are animated, so rank changes glide and logging time shrinks smoothly.
      animate={
        popping
          ? {
              ...geometry,
              scale: reduced ? 1 : [1, 1.18, 1.32],
              opacity: [1, 1, 0],
              transition: {
                default: SPRING,
                scale: { duration: POP_MS / 1000, times: [0, 0.35, 1], ease: "easeOut" },
                opacity: { duration: POP_MS / 1000, times: [0, 0.4, 1], ease: "easeIn" },
              },
            }
          : { ...geometry, scale: 1, opacity: 1 }
      }
      // After a pop the bubble is already gone, so it leaves instantly; deleting one still shrinks away.
      exit={
        popping
          ? { opacity: 0, transition: { duration: 0 } }
          : { scale: [1, 1.28, 0], opacity: [1, 1, 0], transition: { duration: 0.45, times: [0, 0.4, 1] } }
      }
      transition={SPRING}
    >
      {popping && !reduced && <Burst d={place.d} />}
      <motion.button
        type="button"
        onClick={() => onOpen(task.id)}
        disabled={popping}
        aria-label={`${task.title}, ${formatDeadline(task.deadline, now, t, lang)}${repeats ? `, ${t("repeats")} ${repeats}` : ""}${parts ? `, ${progressLabel(task, now, t, lang)}` : ""}`}
        animate={{ y: [0, -amp, 0], x: [0, amp / 2, 0] }}
        transition={{ duration: dur, repeat: Infinity, ease: "easeInOut", delay: index * 0.35 }}
        whileHover={{ scale: 1.07 }}
        whileTap={{ scale: 0.95 }}
        className="relative block h-full w-full cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
      >
        <Orb hue={hue}>
          <BubbleText
            title={task.title}
            diameter={place.d}
            subtitle={
              place.d >= 100
                ? parts ? `${parts.done}/${parts.total} ${t("parts")}` : task.deadline ? formatDeadline(task.deadline, now, t, lang) : undefined
                : undefined
            }
          />
        </Orb>
        {repeats && place.d >= 64 && (
          <span
            title={`${t("Repeats")} ${repeats}`}
            className="glass absolute flex h-5 w-5 items-center justify-center rounded-full text-muted opacity-80"
            style={{ right: place.d * 0.1, top: place.d * 0.1 }}
          >
            <Repeat className="h-3 w-3" aria-hidden />
          </span>
        )}
      </motion.button>
    </motion.div>
  );
}
