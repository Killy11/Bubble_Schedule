"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  /** The user is meant to use the real app during this step: no dimming, clicks pass through. */
  interactive?: boolean;
  id: string;
  /** The target lives inside an app dialog (the card is then placed beside the dialog, not over it). */
  insideModal?: boolean;
  /** Move on by itself when the dialog with this tour id opens ("create" or "task"). */
  advanceOnModal?: string;
  /** Close any open app dialog on entering this step. */
  closeDialogs?: boolean;
}

const steps = (t: TFn): Step[] => [
  {
    id: "add", target: '[data-tour="add-task-btn"]', tab: "bubbles", interactive: true, advanceOnModal: "create",
    title: t("An empty canvas"),
    body: t("The canvas starts empty because every task lives here as a floating bubble. Tap + New bubble to open the Create window."),
  },
  {
    id: "title", target: '[data-tour="field-title"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("Task title"),
    body: t("Name what you plan to do, for example “Write the report”. This text appears on the bubble."),
  },
  {
    id: "duration", target: '[data-tour="field-duration"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("Duration in minutes"),
    body: t("Enter how long the task takes. The longer the task, the BIGGER its bubble. Leave it empty and the AI will estimate it."),
  },
  {
    id: "deadline", target: '[data-tour="field-deadline"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("Deadline and urgency"),
    body: t("The closer the deadline, the more the bubble's colour and glow change (red under a day, yellow 1–5 days, green later), so urgent tasks catch your eye. Now fill the fields in and tap Add bubble: this guide continues when your bubble appears."),
  },
  {
    id: "bubble", target: '[data-tour="first-bubble"]', tab: "bubbles", interactive: true, advanceOnModal: "task", closeDialogs: true,
    title: t("Your first bubble"),
    body: t("Here it is. Bigger means longer, and the colour follows the deadline. Tap your bubble to open its control window."),
  },
  {
    id: "timer", target: '[data-tour="timer-clock"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("Live timer and ✓"),
    body: t("Press ▶ to track your work in real time, ⏸ to pause. Tap ✓ Credit to log it: the elapsed time is turned into whole minutes (rounded down, 03:40 counts as 3)."),
  },
  {
    id: "spent", target: '[data-tour="time-log"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("Time spent and −15 / +15"),
    body: t("No timer? Type the exact minutes you have already spent, or use −15 / +15. The time left updates by itself: left = total − spent."),
  },
  {
    id: "done", target: '[data-tour="done-btn"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("Complete"),
    body: t("When the whole task is finished, tap Complete: the bubble pops with a celebration (and you can Undo)."),
  },
  {
    id: "edit", target: '[data-tour="edit-btn"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("Edit task"),
    body: t("This opens the full editor: change the title, the total duration, the minutes left or the deadline, set a repeat, or delete the task."),
  },
  {
    id: "chat", target: '[data-tour="ai-chat"]', tab: "chat", closeDialogs: true,
    title: t("AI assistant and voice"),
    body: t("Type or dictate with the mic, for example “Put this at 3 PM” or “Plan my day”. The AI assigns tasks to specific hours of your day."),
  },
  {
    id: "schedule", target: '[data-tour="schedule-view"]', tab: "schedule",
    title: t("Your daily schedule"),
    body: t("Tasks the AI times appear here on the timeline, hour by hour. Overdue and Completed are one tap away at the top."),
  },
  {
    id: "settings", target: '[data-tour="settings-btn"]', tab: "bubbles",
    title: t("Notifications and reminders"),
    body: t("In your profile you can turn on notifications for task starts and timer endings. On iPhone, add the site to your Home Screen first (Share → Add to Home Screen)."),
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
  open, onClose, onSelectTab, bubbleCount, onCloseDialogs,
}: {
  /** Close any open app dialog (the tour leaves the Task window when it moves on). */
  onCloseDialogs: () => void;
  open: boolean;
  /** How many bubbles are on the canvas right now (used to notice the first one being created). */
  bubbleCount: number;
  /** `completed` is true for "Get started" and also for Skip / Escape (the guide never nags again). */
  onClose: () => void;
  onSelectTab: (tab: TutorialTab) => void;
}) {
  return <AnimatePresence>{open && <Tour onClose={onClose} onSelectTab={onSelectTab} bubbleCount={bubbleCount} onCloseDialogs={onCloseDialogs} />}</AnimatePresence>;
}

function Tour({ onClose, onSelectTab, bubbleCount, onCloseDialogs }: { onClose: () => void; onSelectTab: (tab: TutorialTab) => void; bubbleCount: number; onCloseDialogs: () => void }) {
  const { t } = useLang();
  const list = useMemo(() => steps(t), [t]);
  const [i, setI] = useState(0);
  const step = list[i];
  const last = i === list.length - 1;
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState({ w: typeof window === "undefined" ? 375 : window.innerWidth, h: typeof window === "undefined" ? 700 : window.innerHeight });
  const cardRef = useRef<HTMLDivElement>(null);
  const baseline = useRef(bubbleCount); // bubbles already there when the guide opened
  const [modalId, setModalId] = useState<string | null>(null); // tour id of the app dialog that is open, if any
  const [modalBox, setModalBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(240);

  // A new bubble appearing while the user is still in the create steps jumps ahead to "tap your bubble".
  const bubbleIdx = list.findIndex((x) => x.id === "bubble");
  useEffect(() => {
    if (bubbleCount > baseline.current) {
      baseline.current = bubbleCount;
      if (i < bubbleIdx) {
        const id = setTimeout(() => setI(bubbleIdx), 450); // let the new bubble settle first
        return () => clearTimeout(id);
      }
    }
  }, [bubbleCount, bubbleIdx, i]);
  // A step that waits for a dialog moves on the moment it opens.
  useEffect(() => {
    if (step.advanceOnModal && modalId === step.advanceOnModal) {
      const id = setTimeout(() => setI((n) => Math.min(n + 1, list.length - 1)), 350);
      return () => clearTimeout(id);
    }
  }, [modalId, step.advanceOnModal, list.length]);
  // Leaving the bubble's window behind for the chat / schedule steps.
  useEffect(() => {
    if (step.closeDialogs) onCloseDialogs();
  }, [step.closeDialogs, onCloseDialogs]);

  // Show the tab this step needs.
  useEffect(() => {
    onSelectTab(step.tab);
  }, [step.tab, onSelectTab]);

  // Measure the target and keep it current (it may appear a moment after a tab switch; the layout can also change).
  const target = step.target;
  useEffect(() => {
    const measure = () => {
      const modal = document.querySelector("[data-tour-modal]") as HTMLElement | null;
      setModalId(modal ? modal.getAttribute("data-tour-modal") : null);
      const mr = modal?.getBoundingClientRect();
      setModalBox((b) => {
        const nb = mr ? { x: mr.left, y: mr.top, w: mr.width, h: mr.height } : null;
        return b && nb && Math.abs(b.x - nb.x) < 0.5 && Math.abs(b.y - nb.y) < 0.5 && Math.abs(b.w - nb.w) < 0.5 && Math.abs(b.h - nb.h) < 0.5 ? b : nb;
      });
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
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return; // typing
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
  // A step inside an app dialog: put the card beside the dialog on wide screens, or at the very top on a phone.
  if (step.insideModal && modalBox) {
    if (view.w >= 900 && modalBox.x + modalBox.w + M + cardW <= view.w) {
      left = modalBox.x + modalBox.w + M;
      top = box ? box.y : modalBox.y;
    } else if (view.w >= 900 && modalBox.x - M - cardW >= 0) {
      left = modalBox.x - M - cardW;
      top = box ? box.y : modalBox.y;
    } else {
      top = M;
    }
  }
  top = Math.min(Math.max(M, top), Math.max(M, view.h - cardH - M));

  return (
    <motion.div data-tour-card className={`fixed inset-0 z-[90] ${step.interactive ? "pointer-events-none" : ""}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label={t("Help")}>
      {/* catches clicks so the app underneath can't be used mid-tour */}
      {!step.interactive && <div className="absolute inset-0" />}
      {box && step.interactive ? (
        (
          <div
            aria-hidden
            className="pointer-events-none fixed animate-pulse rounded-3xl border-2 border-white/70 transition-all duration-300"
            style={{ left: box.x, top: box.y, width: box.w, height: box.h, boxShadow: "0 0 24px 4px rgba(255,255,255,0.45)" }}
          />
        )
      ) : box ? (
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
        data-tour-card
        key={i}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="pointer-events-auto fixed max-h-[calc(100dvh-24px)] overflow-y-auto overscroll-contain rounded-3xl border border-white/12 bg-[#111116]/95 p-5 text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur-xl"
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
          <button type="button" onClick={next}
            className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition hover:opacity-90">
            {last ? t("🚀 Get started") : `${t("Next")} →`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
