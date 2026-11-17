"use client";

import { motion } from "framer-motion";
import { Orb } from "@/components/Orb";
import { BubbleText } from "./BubbleText";
import { bubbleHue } from "@/lib/bubbles/urgency";
import { formatDeadline } from "@/lib/time";
import type { Task } from "@/types";
import type { BubblePlacement } from "@/lib/bubbles/layout";

const SPRING = { type: "spring", stiffness: 70, damping: 16, mass: 1 } as const;

export function Bubble({
  task,
  place,
  now,
  index,
  onOpen,
}: {
  task: Task;
  place: BubblePlacement;
  now: number;
  index: number;
  onOpen: (id: string) => void;
}) {
  const hue = bubbleHue(task, now);
  // Each bubble drifts on its own slow loop.
  const dur = 5 + (index % 5) * 1.3;
  const amp = 5 + (index % 3) * 2;

  return (
    <motion.div
      className="absolute left-0 top-0"
      initial={{ x: place.x, y: place.y, width: place.d, height: place.d, scale: 0, opacity: 0 }}
      // Position AND size are animated, so rank changes glide and logging time shrinks smoothly.
      animate={{ x: place.x, y: place.y, width: place.d, height: place.d, scale: 1, opacity: 1 }}
      exit={{ scale: [1, 1.28, 0], opacity: [1, 1, 0], transition: { duration: 0.45, times: [0, 0.4, 1] } }}
      transition={SPRING}
    >
      <motion.button
        type="button"
        onClick={() => onOpen(task.id)}
        aria-label={`${task.title}, due ${formatDeadline(task.deadline, now)}`}
        animate={{ y: [0, -amp, 0], x: [0, amp / 2, 0] }}
        transition={{ duration: dur, repeat: Infinity, ease: "easeInOut", delay: index * 0.35 }}
        whileHover={{ scale: 1.07 }}
        whileTap={{ scale: 0.95 }}
        className="block h-full w-full cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
      >
        <Orb hue={hue}>
          <BubbleText
            title={task.title}
            diameter={place.d}
            subtitle={place.d >= 100 ? formatDeadline(task.deadline, now) : undefined}
          />
        </Orb>
      </motion.button>
    </motion.div>
  );
}
