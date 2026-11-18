"use client";

import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { setTutorialActive } from "@/lib/tutorialLock";
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
  /** The user must do the thing themselves: there is no Next button, only a quiet Skip. */
  mandatory?: boolean;
  /** Move on by itself when the dialog with this tour id closes. */
  advanceOnModalClose?: string;
  /** Put the card at the top edge of the screen so it never covers the target (the AI chat step). */
  pinTop?: boolean;
  /** Open this drawer for the step (and close it again afterwards). */
  drawer?: "profile";
}

const steps = (t: TFn, isDesktop: boolean, narrow: boolean): Step[] => [
  {
    id: "add", target: '[data-tour="add-task-btn"]', tab: "bubbles", interactive: true, mandatory: true, advanceOnModal: "create",
    title: t("Let's start with your first bubble!"),
    body: t("Tap the + button to create your first bubble."),
  },
  {
    id: "title", target: '[data-tour="field-title"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("1. Task title"),
    body: t("Write what you are going to do. For example “Prepare the presentation” or “Workout”."),
  },
  {
    id: "duration", target: '[data-tour="field-duration"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("2. Duration in minutes"),
    body: t("Enter how many minutes it takes (for example 45). The more minutes, the BIGGER the bubble on screen."),
  },
  {
    id: "mode", target: '[data-tour="field-mode"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("3. Focus mode"),
    body: t("Pick how you work: Locked In (deep focus), Normal (usual pace) or Chill (an easy task, no rush)."),
  },
  {
    id: "deadline", target: '[data-tour="field-deadline"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("4. Deadline"),
    body: t("Set a deadline (for example tonight or tomorrow). The closer the deadline, the brighter the bubble glows."),
  },
  {
    id: "submit", target: '[data-tour="field-submit"]', tab: "bubbles", interactive: true, insideModal: true, mandatory: true,
    title: t("Create it"),
    body: t("Done! Tap “Create”: your first bubble appears on the canvas."),
  },
  {
    id: "bubble", target: '[data-tour="first-bubble"]', tab: "bubbles", interactive: true, mandatory: true, advanceOnModal: "task", closeDialogs: true,
    title: t("Tap your bubble"),
    body: t("Tap right on the bubble you created to open its timer window."),
  },
  {
    id: "timer", target: '[data-tour="timer-clock"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("Live timer"),
    body: t("▶ Start tracks your work in real time. ✓ Log minutes adds the time you worked, rounded down to whole minutes (03:40 counts as 3)."),
  },
  {
    id: "manual", target: '[data-tour="time-log"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("Log time manually"),
    body: t("Worked without the timer? Pick the minutes with −15 / +15 and tap “Log N min”. When the time spent reaches the total, the bubble pops by itself."),
  },
  {
    id: "actions", target: '[data-tour="modal-actions"]', tab: "bubbles", interactive: true, insideModal: true,
    title: t("Log, edit and finish"),
    body: t("“Log N min” adds the time you worked to your progress, and the bubble stays on the canvas. “🎉 Finish task”: tap it when the task is completely done, to remove the bubble from the canvas. “Edit task” changes the title, duration, mode and deadline."),
  },
  {
    id: "close", target: '[data-tour="close-task-modal"]', tab: "bubbles", interactive: true, insideModal: true, mandatory: true, advanceOnModalClose: "task",
    title: t("Close the window"),
    body: t("Tap the ✕ to close the task window."),
  },
  isDesktop
    ? {
        id: "tabs", target: '[data-tour="desktop-panels"]', tab: "bubbles",
        title: t("Your workspace"),
        body: t("On a computer the canvas with your bubbles is always open, and the Schedule and the AI chat are always next to it."),
      }
    : {
        id: "tabs", target: '[data-tour="mobile-nav"]', tab: "bubbles",
        title: t("Three tabs"),
        body: t("At the bottom of the screen there are 3 main tabs to switch between: Bubbles, Schedule and AI Chat."),
      },
  {
    id: "chat", target: '[data-tour="ai-chat"]', tab: "chat", interactive: true, pinTop: true, closeDialogs: true,
    title: t("Try the AI chat"),
    body: t("Write or dictate a message right now, for example “Put my task at 4 PM” or “Add coffee for 15 min”, send it and watch the AI answer. Press Next when you're done."),
  },
  {
    id: "schedule", target: '[data-tour="auto-schedule-btn"]', tab: "schedule",
    title: t("Schedule and Auto-schedule"),
    body: t("Whenever you add or change a task, your schedule updates. There is also an “Auto-schedule” button that places your tasks into the free slots by itself. And if you want something your own way, just ask the AI chat."),
  },
  {
    id: "account", target: '[data-tour="settings-btn"]', tab: "bubbles",
    title: t("Account and settings"),
    body: t("In your account and settings you manage your profile, set up notifications for task starts and the timer, and adapt the app to yourself."),
  },
  {
    id: "theme", target: '[data-tour="theme-toggle"]', tab: "bubbles",
    title: t("Light or dark theme"),
    body: t("Here you can switch between the light and the dark theme."),
  },
  {
    id: "feedback", target: '[data-tour="feedback-btn"]', tab: "bubbles", drawer: narrow ? "profile" : undefined,
    title: t("Feedback"),
    body: t("Leave a review or an idea with the “Feedback” button."),
  },
  {
    id: "support", target: '[data-tour="support-btn"]', tab: "bubbles",
    title: t("Support us"),
    body: t("We also have a “Support” button: if you like the app, please support us!"),
  },
  {
    id: "help", target: '[data-tour="help-btn"]', tab: "bubbles",
    title: t("You can always come back"),
    body: t("And don't worry: if anything is unclear, you can always tap here (or open the settings) and watch this tutorial again!"),
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
  open, onClose, onSelectTab, bubbleCount, onCloseDialogs, onSetProfileOpen,
}: {
  /** Open or close the profile drawer (used by the steps that point at controls inside it). */
  onSetProfileOpen: (open: boolean) => void;
  /** Close any open app dialog (the tour leaves the Task window when it moves on). */
  onCloseDialogs: () => void;
  open: boolean;
  /** How many bubbles are on the canvas right now (used to notice the first one being created). */
  bubbleCount: number;
  /** `completed` is true for "Get started" and also for Skip / Escape (the guide never nags again). */
  onClose: () => void;
  onSelectTab: (tab: TutorialTab) => void;
}) {
  if (typeof document === "undefined") return null;
  // A portal on <body> with z-[9999]: always above the app's own dialogs.
  return createPortal(
    <AnimatePresence>{open && <Tour onClose={onClose} onSelectTab={onSelectTab} bubbleCount={bubbleCount} onCloseDialogs={onCloseDialogs} onSetProfileOpen={onSetProfileOpen} />}</AnimatePresence>,
    document.body,
  );
}

function Tour({ onClose, onSelectTab, bubbleCount, onCloseDialogs, onSetProfileOpen }: { onClose: () => void; onSelectTab: (tab: TutorialTab) => void; bubbleCount: number; onCloseDialogs: () => void; onSetProfileOpen: (open: boolean) => void }) {
  const { t } = useLang();
  // The layout switches at Tailwind's lg (1024 px): that is where the canvas, Schedule and chat share the screen.
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 640); // header hides Feedback
  useEffect(() => {
    const on = () => {
      setIsDesktop(window.matchMedia("(min-width: 1024px)").matches);
      setNarrow(window.innerWidth < 640);
    };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const list = useMemo(() => steps(t, isDesktop, narrow), [t, isDesktop, narrow]);

  // While the tour runs, app dialogs ignore backdrop clicks and Escape.
  useEffect(() => {
    setTutorialActive(true);
    return () => setTutorialActive(false);
  }, []);
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
  // A step that waits for a dialog to close moves on the moment it does (not while it is still open).
  const sawModal = useRef(false);
  useEffect(() => {
    if (!step.advanceOnModalClose) {
      sawModal.current = false;
      return;
    }
    if (modalId === step.advanceOnModalClose) sawModal.current = true;
    else if (sawModal.current || modalId === null) setI((n) => Math.min(n + 1, list.length - 1));
  }, [modalId, step.advanceOnModalClose, list.length]);
  // Leaving the bubble's window behind for the chat / schedule steps.
  useEffect(() => {
    if (step.closeDialogs) onCloseDialogs();
  }, [step.closeDialogs, onCloseDialogs]);

  // Steps that point at a control inside the profile drawer open it; every other step keeps it closed.
  const drawer = step.drawer;
  useEffect(() => {
    onSetProfileOpen(drawer === "profile");
    return () => onSetProfileOpen(false);
  }, [drawer, onSetProfileOpen]);

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
      // `target` may list several selectors (e.g. phone nav vs desktop tabs): use the first one that is actually visible.
      const el = target ? ([...document.querySelectorAll(target)] as HTMLElement[]).find((e) => e.getBoundingClientRect().width > 1) ?? null : null;
      const r = el?.getBoundingClientRect();
      if (!r || r.width < 2 || r.height < 2) return setBox((b) => (b === null ? b : null));
      const next = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
      setBox((b) => (b && Math.abs(b.x - next.x) < 0.5 && Math.abs(b.y - next.y) < 0.5 && Math.abs(b.w - next.w) < 0.5 && Math.abs(b.h - next.h) < 0.5 ? b : next));
    };
    const el0 = target ? ([...document.querySelectorAll(target)] as HTMLElement[]).find((e) => e.getBoundingClientRect().width > 1) ?? null : null;
    el0?.scrollIntoView({ block: "nearest" });
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

  const handlers = useRef({ onClose, last, mandatory: !!step.mandatory });
  useEffect(() => {
    handlers.current = { onClose, last, mandatory: !!step.mandatory };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return; // typing
      // Escape does nothing: the tutorial ends only with Skip or its last step.
      if (e.key === "ArrowRight") {
        if (handlers.current.mandatory) return;
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
  // The chat step: the card hugs the top edge so the whole chat (messages, input, mic, send) stays visible and usable.
  if (step.pinTop) top = M;
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
    <motion.div data-tour-card className="fixed inset-0 z-[9999]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label={t("Help")}>
      {/*
        The dimmed backdrop is built from blocking panels around the spotlight: every pointer event outside the cutout is
        swallowed (nothing underneath can be clicked, so no dialog closes and the tutorial can't be left by a stray tap).
        Inside the cutout events pass through to the real control on interactive steps; on the others the cutout is
        covered too, so the highlighted control is only shown, not pressed.
      */}
      {(() => {
        const vw = view.w;
        const vh = view.h;
        const eat = {
          onPointerDown: (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); },
          onClick: (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); },
          onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(),
          onWheel: (e: React.SyntheticEvent) => e.stopPropagation(),
        };
        const dim = "rgba(0,0,0,0.72)";
        if (!box) return <div aria-hidden className="pointer-events-auto fixed inset-0" style={{ background: dim }} {...eat} />;
        const x = Math.max(0, box.x);
        const y = Math.max(0, box.y);
        const r = Math.min(vw, box.x + box.w);
        const b = Math.min(vh, box.y + box.h);
        const panel = "pointer-events-auto fixed";
        return (
          <>
            <div aria-hidden className={panel} style={{ left: 0, top: 0, width: vw, height: y, background: dim }} {...eat} />
            <div aria-hidden className={panel} style={{ left: 0, top: b, width: vw, height: Math.max(0, vh - b), background: dim }} {...eat} />
            <div aria-hidden className={panel} style={{ left: 0, top: y, width: x, height: Math.max(0, b - y), background: dim }} {...eat} />
            <div aria-hidden className={panel} style={{ left: r, top: y, width: Math.max(0, vw - r), height: Math.max(0, b - y), background: dim }} {...eat} />
            {!step.interactive && <div aria-hidden className={panel} style={{ left: x, top: y, width: Math.max(0, r - x), height: Math.max(0, b - y) }} {...eat} />}
            <div
              aria-hidden
              className={`pointer-events-none fixed rounded-3xl border-2 border-white/70 transition-all duration-300 ${step.interactive ? "animate-pulse" : ""}`}
              style={{ left: box.x, top: box.y, width: box.w, height: box.h, boxShadow: "0 0 24px 4px rgba(255,255,255,0.45)" }}
            />
          </>
        );
      })()}
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
            <button type="button" onClick={onClose} className="rounded-full px-2 py-1 transition hover:text-white">{step.mandatory ? t("Skip tutorial") : t("Skip")}</button>
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
          {!step.mandatory && (
            <button type="button" onClick={next}
              className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition hover:opacity-90">
              {last ? t("🚀 Get started") : `${t("Next")} →`}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Shown once to a brand-new account: take the interactive tutorial, or go straight into the app. */
export function TutorialWelcome({ open, onYes, onNo }: { open: boolean; onYes: () => void; onNo: () => void }) {
  const { t } = useLang();
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/65 p-4 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("Interactive tutorial")}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="max-h-[90dvh] w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-[28px] border border-white/12 bg-[#111116]/95 p-7 text-center text-zinc-100 shadow-[0_24px_80px_rgba(0,0,0,0.75)] sm:p-8"
          >
            <p className="text-[16px] font-medium leading-[1.5]">{t("Would you like to get to know the app with an interactive tutorial?")}</p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button type="button" onClick={onYes}
                className="rounded-full bg-white px-5 py-3 text-sm font-medium text-black transition hover:opacity-90">
                {t("Yes, show me (tutorial)")}
              </button>
              <button type="button" onClick={onNo}
                className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm text-zinc-300 transition hover:bg-white/[0.08]">
                {t("No, I already know the app")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
