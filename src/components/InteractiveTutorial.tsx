"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Minus, Pause, Play, Plus } from "lucide-react";
import { useLang, type TFn } from "@/context/LanguageProvider";

export const TUTORIAL_KEY = "bubbleschedule_tutorial_completed_v1";
export type TutorialTab = "bubbles" | "schedule" | "chat";

interface Step {
  /** CSS selector of the real element to spotlight; none = a centred card. */
  target?: string;
  /** Which tab must be showing (phones show one panel at a time; on desktop it also picks the side panel). */
  tab: TutorialTab;
  title: string;
  body: string;
  extra?: ReactNode;
}

/** A small static copy of the Timer & Quick Actions window, so the step can show what a tap opens. */
function TimerPreview({ t }: { t: TFn }) {
  return (
    <div aria-hidden className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-center text-xs">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white/5 py-1.5"><p className="text-[10px] text-zinc-400">{t("Elapsed")}</p><p className="text-lg font-semibold tabular-nums">12:34</p></div>
        <div className="rounded-xl bg-white/5 py-1.5"><p className="text-[10px] text-zinc-400">{t("Time left")}</p><p className="text-lg font-semibold tabular-nums">47:26</p></div>
      </div>
      <div className="flex items-center justify-center gap-1.5">
        <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1"><Play className="h-3 w-3 fill-current" /><Pause className="h-3 w-3 fill-current" /></span>
        <span className="flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1"><Check className="h-3 w-3" /> {t("Credit")}</span>
      </div>
      <div className="flex items-center justify-center gap-1.5">
        <span className="flex items-center rounded-full border border-white/15 px-2 py-1"><Minus className="h-3 w-3" />15</span>
        <span className="rounded-lg border border-white/15 px-3 py-1 tabular-nums">25</span>
        <span className="flex items-center rounded-full border border-white/15 px-2 py-1"><Plus className="h-3 w-3" />15</span>
      </div>
      <div className="flex gap-1.5">
        <span className="flex-1 rounded-full bg-white py-1.5 font-medium text-black">✓ {t("Complete")}</span>
        <span className="flex-1 rounded-full border border-white/15 py-1.5">✎ {t("Edit task")}</span>
      </div>
    </div>
  );
}

const steps = (t: TFn): Step[] => [
  {
    target: '[data-tour="bubble-canvas"]', tab: "bubbles",
    title: t("Every bubble is a task"),
    body: t("Bigger bubbles are longer tasks. Colour shows the deadline: red is under a day, yellow is 1–5 days, green is 5+ days or no deadline."),
  },
  {
    target: '[data-tour="bubble-canvas"]', tab: "bubbles",
    title: t("Tap a bubble: timer and quick actions"),
    body: t("A tap opens the timer first: run it, tap Credit to log whole minutes (rounded down), adjust the time left with −15 / a number / +15, tap Complete, or open Edit task."),
    extra: <TimerPreview t={t} />,
  },
  {
    target: '[data-tour="add-task-btn"]', tab: "bubbles",
    title: t("Add a task"),
    body: t("Tap New bubble to create one by hand: a title, a duration in minutes and a deadline. Everything but the title is optional."),
  },
  {
    target: '[data-tour="ai-chat"]', tab: "chat",
    title: t("AI assistant and voice"),
    body: t("Type or tap the mic and speak: “send the report tomorrow 5pm”. The AI creates tasks, changes them and plans your day."),
  },
  {
    target: '[data-tour="schedule-view"]', tab: "schedule",
    title: t("Your daily schedule"),
    body: t("The timeline lists what to do and when, day by day. Overdue and Completed tasks are one tap away at the top."),
  },
  {
    target: '[data-tour="settings-btn"]', tab: "bubbles",
    title: t("Notifications and reminders"),
    body: t("In your profile you can turn on notifications for task starts and timer endings. On iPhone, add the site to your Home Screen first (Share → Add to Home Screen)."),
  },
  {
    tab: "bubbles",
    title: t("You're ready!"),
    body: t("That's all. You can replay this guide any time from the ? button or your profile."),
  },
];

type Box = { x: number; y: number; w: number; h: number };
const PAD = 6;

/**
 * Spotlight walkthrough over the real UI. It measures the target element (and keeps measuring on resize, scroll and
 * layout changes), dims everything else with a glowing cutout, and puts the tip card where it fits on screen, even on a
 * 375 px phone. `onSelectTab` switches the app's tab so each step's target is actually on screen.
 */
export function InteractiveTutorial({
  open, onClose, onSelectTab,
}: {
  open: boolean;
  /** `completed` is true for "Get started" and also for Skip / Escape (the guide never nags again). */
  onClose: () => void;
  onSelectTab: (tab: TutorialTab) => void;
}) {
  return <AnimatePresence>{open && <Tour onClose={onClose} onSelectTab={onSelectTab} />}</AnimatePresence>;
}

function Tour({ onClose, onSelectTab }: { onClose: () => void; onSelectTab: (tab: TutorialTab) => void }) {
  const { t } = useLang();
  const list = useMemo(() => steps(t), [t]);
  const [i, setI] = useState(0);
  const step = list[i];
  const last = i === list.length - 1;
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState({ w: typeof window === "undefined" ? 375 : window.innerWidth, h: typeof window === "undefined" ? 700 : window.innerHeight });
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(240);

  // Show the tab this step needs.
  useEffect(() => {
    onSelectTab(step.tab);
  }, [step.tab, onSelectTab]);

  // Measure the target and keep it current (it may appear a moment after a tab switch; the layout can also change).
  const target = step.target;
  useEffect(() => {
    const measure = () => {
      setView((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
      const el = target ? (document.querySelector(target) as HTMLElement | null) : null;
      const r = el?.getBoundingClientRect();
      if (!r || r.width < 2 || r.height < 2) return setBox((b) => (b === null ? b : null));
      const next = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
      setBox((b) => (b && Math.abs(b.x - next.x) < 0.5 && Math.abs(b.y - next.y) < 0.5 && Math.abs(b.w - next.w) < 0.5 && Math.abs(b.h - next.h) < 0.5 ? b : next));
    };
    const first = requestAnimationFrame(measure);
    const id = setInterval(measure, 150);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [target]);
  useLayoutEffect(() => {
    if (cardRef.current) setCardH(cardRef.current.offsetHeight);
  }, [i, box, t]);

  const handlers = useRef({ onClose, last });
  useEffect(() => {
    handlers.current = { onClose, last };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handlers.current.onClose();
      else if (e.key === "ArrowRight") {
        if (handlers.current.last) handlers.current.onClose();
        else setI((n) => n + 1);
      }
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const next = () => (last ? onClose() : setI((n) => n + 1));

  // Card position: below the target if it fits, else above, else inside the target's bottom edge; always on screen.
  const M = 12;
  const cardW = Math.min(360, view.w - M * 2);
  let top = Math.max(M, (view.h - cardH) / 2);
  let left = (view.w - cardW) / 2;
  if (box) {
    const below = view.h - (box.y + box.h) - M;
    const above = box.y - M;
    if (below >= cardH) top = box.y + box.h + M;
    else if (above >= cardH) top = box.y - cardH - M;
    else top = Math.max(M, Math.min(box.y + box.h, view.h) - cardH - M * 4);
    left = Math.min(Math.max(M, box.x + box.w / 2 - cardW / 2), view.w - cardW - M);
  }
  top = Math.min(Math.max(M, top), Math.max(M, view.h - cardH - M));

  return (
    <motion.div className="fixed inset-0 z-[90]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label={t("Help")}>
      {/* catches clicks so the app underneath can't be used mid-tour */}
      <div className="absolute inset-0" />
      {box ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-3xl border border-white/40 transition-all duration-300 ease-out"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h, boxShadow: "0 0 0 9999px rgba(0,0,0,0.72), 0 0 28px 4px rgba(255,255,255,0.35)" }}
        />
      ) : (
        <div aria-hidden className="pointer-events-none fixed inset-0" style={{ background: "rgba(0,0,0,0.72)" }} />
      )}
      <motion.div
        ref={cardRef}
        key={i}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-3xl border border-white/12 bg-[#111116]/95 p-5 text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
        style={{ top, left, width: cardW }}
      >
        <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
          <span>{t("Step {a} of {b}", { a: i + 1, b: list.length })}</span>
          {!last && (
            <button type="button" onClick={onClose} className="rounded-full px-2 py-1 transition hover:text-white">{t("Skip")}</button>
          )}
        </div>
        <h2 className="text-base font-semibold tracking-tight">{step.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{step.body}</p>
        {step.extra}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0}
            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-30">
            ← {t("Back")}
          </button>
          <button type="button" autoFocus onClick={next}
            className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition hover:opacity-90">
            {last ? t("🚀 Get started") : `${t("Next")} →`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
