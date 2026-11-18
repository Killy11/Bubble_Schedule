"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Bubble } from "./Bubble";
import { BubbleQuickBar } from "./BubbleQuickBar";
import { bubbleDiameter } from "@/lib/bubbles/sizing";
import { taskWeight } from "@/lib/bubbles/weight";
import { layoutBubbles } from "@/lib/bubbles/layout";
import type { Task } from "@/types";

/** Bubbles drawn on the canvas at most; every active task is still in the Schedule. */
export const MAX_BUBBLES = 50;

export function BubbleCanvas({
  tasks,
  now,
  onEdit,
  onComplete,
  onAdjust,
  onToggleTimer,
  poppingIds,
}: {
  tasks: Task[];
  now: number;
  /** Open the full Edit Task modal (the ✎ in the quick bar, or a double-click). */
  onEdit: (id: string) => void;
  onComplete: (task: Task) => void;
  onAdjust: (task: Task, deltaMin: number) => void;
  onToggleTimer: (task: Task) => void;
  /** Bubbles playing their pop animation (task being completed). */
  poppingIds?: ReadonlySet<string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  // The selection follows the task: it clears itself when the bubble pops, completes or leaves the canvas.
  const selected = shown.find((t) => t.id === selectedId && !poppingIds?.has(t.id)) ?? null;
  const selectedPlace = selected ? placeById.get(selected.id) : undefined;

  return (
    <div
      ref={ref}
      className="relative h-full min-h-0 w-full overflow-hidden touch-none"
      // Tapping empty canvas dismisses the quick bar (bubbles and the bar mark themselves data-keep).
      onPointerDown={(e) => {
        if (!(e.target as HTMLElement).closest("[data-keep]")) setSelectedId(null);
      }}
    >
      <AnimatePresence>
        {shown.map((t, i) => {
          const place = placeById.get(t.id);
          return place ? (
            <Bubble
              key={t.id}
              task={t}
              place={place}
              now={now}
              index={i}
              selected={selected?.id === t.id}
              onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
              onEdit={(id) => { setSelectedId(null); onEdit(id); }}
              onComplete={() => { setSelectedId(null); onComplete(t); }}
              onAdjust={(_id, d) => onAdjust(t, d)}
              popping={poppingIds?.has(t.id) ?? false}
            />
          ) : null;
        })}
      </AnimatePresence>
      <AnimatePresence>
        {selected && selectedPlace && (
          <BubbleQuickBar
            key={selected.id}
            task={selected}
            place={selectedPlace}
            canvasW={size.w}
            canvasH={size.h}
            onComplete={() => { setSelectedId(null); onComplete(selected); }}
            onAdjust={(d) => onAdjust(selected, d)}
            onToggleTimer={() => onToggleTimer(selected)}
            onEdit={() => { setSelectedId(null); onEdit(selected.id); }}
          />
        )}
      </AnimatePresence>
      {tasks.length > shown.length && (
        <span className="absolute bottom-2 right-3 text-[11px] text-muted">+{tasks.length - shown.length}</span>
      )}
    </div>
  );
}
