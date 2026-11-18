"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Bubble } from "./Bubble";
import { bubbleDiameter } from "@/lib/bubbles/sizing";
import { taskWeight } from "@/lib/bubbles/weight";
import { layoutBubbles } from "@/lib/bubbles/layout";
import type { Task } from "@/types";

/** Bubbles drawn on the canvas at most; every active task is still in the Schedule. */
export const MAX_BUBBLES = 50;

export function BubbleCanvas({
  tasks,
  now,
  onOpen,
  poppingIds,
}: {
  tasks: Task[];
  now: number;
  onOpen: (id: string) => void;
  /** Bubbles playing their pop animation (task being completed). */
  poppingIds?: ReadonlySet<string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // Bubbles are sized in JS, so the Tailwind `sm` breakpoint (640px) is mirrored here:
  // smaller base size on phones; layoutBubbles then applies one global fit-scale when crowded.
  const compact = useMediaQuery("(max-width: 639px)");
  const base = compact ? 0.78 : 1;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Only the 50 most urgent bubbles are drawn, so a crowded canvas stays fast (the rest are in the Schedule).
  const shown = useMemo(
    () => (tasks.length <= MAX_BUBBLES ? tasks : [...tasks].sort((a, b) => taskWeight(b, now) - taskWeight(a, now)).slice(0, MAX_BUBBLES)),
    [tasks, now],
  );
  const specs = useMemo(
    () => shown.map((t) => ({ id: t.id, d: bubbleDiameter(t, now, base), weight: taskWeight(t, now) })),
    [shown, now, base],
  );
  const placements = useMemo(() => layoutBubbles(specs, size.w, size.h), [specs, size]);
  const placeById = new Map(placements.map((p) => [p.id, p]));

  return (
    <div ref={ref} className="relative h-full min-h-[320px] w-full overflow-hidden">
      <AnimatePresence>
        {shown.map((t, i) => {
          const place = placeById.get(t.id);
          return place ? (
            <Bubble key={t.id} task={t} place={place} now={now} index={i} onOpen={onOpen} popping={poppingIds?.has(t.id) ?? false} />
          ) : null;
        })}
      </AnimatePresence>
      {tasks.length > shown.length && (
        <span className="absolute bottom-2 right-3 text-[11px] text-muted">+{tasks.length - shown.length}</span>
      )}
    </div>
  );
}
