"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { Bubble } from "./Bubble";
import { bubbleDiameter } from "@/lib/bubbles/sizing";
import { taskWeight } from "@/lib/bubbles/weight";
import { ADD_BUBBLE_D, layoutBubbles } from "@/lib/bubbles/layout";
import { useLang } from "@/context/LanguageProvider";
import { Plus } from "lucide-react";
import type { Task } from "@/types";

/** Bubbles drawn on the canvas at most; every active task is still in the Schedule. */
export const MAX_BUBBLES = 50;

export function BubbleCanvas({
  tasks,
  now,
  onOpen,
  tutorialBubbleId,
  onCreate,
  poppingIds,
}: {
  tasks: Task[];
  now: number;
  /** A tap or click on a bubble opens the Task modal. */
  onOpen: (id: string) => void;
  /** The permanent "+" bubble in the centre: opens the Create window. */
  onCreate: () => void;
  /** Id of the bubble created during the tutorial. */
  tutorialBubbleId?: string | null;
  /** Bubbles playing their pop animation (task being completed). */
  poppingIds?: ReadonlySet<string>;
}) {
  const { t } = useLang();
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
    <div ref={ref} className="relative h-full min-h-0 w-full overflow-hidden touch-none">
      {/* The permanent "+" bubble: fixed 80 px, always at the centre; task bubbles pack around it. */}
      {size.w > 0 && (
        <button
          type="button"
          data-tour="add-task-bubble"
          onClick={onCreate}
          aria-label={t("New bubble")}
          title={t("New bubble")}
          className="glass absolute flex items-center justify-center rounded-full text-foreground outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-foreground/40"
          style={{
            width: ADD_BUBBLE_D,
            height: ADD_BUBBLE_D,
            left: size.w / 2 - ADD_BUBBLE_D / 2,
            top: size.h / 2 - ADD_BUBBLE_D / 2,
            boxShadow: "0 0 22px 2px rgb(var(--glow-a) / 0.35), inset 0 0 16px rgb(var(--glow-a) / 0.25)",
            borderColor: "rgb(var(--glow-a) / 0.6)",
          }}
        >
          <Plus className="h-8 w-8" strokeWidth={1.75} />
        </button>
      )}
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
              onOpen={onOpen}
              tutorialTarget={t.id === tutorialBubbleId}
              popping={poppingIds?.has(t.id) ?? false}
            />
          ) : null;
        })}
      </AnimatePresence>
      {tasks.length > shown.length && (
        <span className="absolute bottom-2 right-3 text-[11px] text-muted">+{tasks.length - shown.length}</span>
      )}
    </div>
  );
}
