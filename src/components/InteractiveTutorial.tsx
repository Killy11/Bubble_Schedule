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
  body?: string;
  extra?: ReactNode;
  /** The user is meant to use the real app during this step: no dimming, clicks pass through. */
  interactive?: boolean;
  id: string;
  /** The target lives inside an app dialog (the card is then placed beside the dialog, not over it). */
  insideModal?: boolean;
  /** Move on by itself when the dialog with this tour id opens ("create" or "task"). */
  advanceOnModal?: string;
  /** The dialog this step needs on screen. Entering the step (forward or back) puts the app in that state. */
  requires?: "create" | "task";
  /** The user must do the thing themselves: there is no Next button, only a quiet Skip. */
  mandatory?: boolean;
  /** Move on by itself when the dialog with this tour id closes. */
  advanceOnModalClose?: string;
  /** Put the card at the top edge of the screen so it never covers the target (the AI chat step). */
  pinTop?: boolean;
  /** Open this drawer for the step (and close it again afterwards). */
  drawer?: "profile";
  /** The target selector lists several controls: spotlight them all together (their bounding box). */
  union?: boolean;
}

const steps = (t: TFn, isDesktop: boolean, hasBubble: boolean): Step[] => [
  {
    id: "add", target: '[data-tour="add-task-bubble"]', tab: "bubbles", interactive: true, mandatory: true, advanceOnModal: "create",
    title: t("Your first task"),
    body: t("Tap the central bubble with the plus to create your first task."),
  },
  {
    // One step for the whole Create window: no field-by-field walkthrough, the labels explain themselves.
    id: "submit", target: '[data-tour-modal="create"]', tab: "bubbles", interactive: true, insideModal: true, mandatory: true, requires: "create",
    title: t("Create your first task"),
    // After the bubble exists, coming back here reopens it for editing (the button then says Save).
    body: hasBubble ? t("Tap “Save” (or “Next →”) to go back to the bubble.") : undefined,
  },
  {
    id: "bubble", target: '[data-tour="tutorial-target-bubble"]', tab: "bubbles", interactive: true, mandatory: true, advanceOnModal: "task",
    title: t("Tap your bubble"),
    body: t("Now tap right on the bubble you created to open its time controls."),
  },
  {
    id: "controls", target: '[data-tour="timer-clock"], [data-tour="time-log"], [data-tour="modal-actions"]', union: true, tab: "bubbles", interactive: true, insideModal: true, requires: "task",
    title: t("Task controls"),
    body: t("Run the live timer or add minutes by hand (−15 / +15, “Log”). “Edit task” changes the details, and “🎉 Finish task” removes the bubble from the canvas when the task is completely done."),
  },
  {
    id: "close", target: '[data-tour="close-task-modal"]', tab: "bubbles", interactive: true, insideModal: true, mandatory: true, advanceOnModalClose: "task", requires: "task",
    title: t("Close the window"),
    body: t("Tap the ✕ to close the task window."),
  },
  isDesktop
    ? {
        id: "tabs", target: '[data-tour="desktop-panels"]', tab: "bubbles",
        title: t("Your workspace"),
        body: t("On a computer the bubbles are always on screen, with the Schedule and the AI chat open next to them."),
      }
    : {
        id: "tabs", target: '[data-tour="mobile-nav"]', tab: "bubbles",
        title: t("Three tabs"),
        body: t("At the bottom there are 3 tabs to switch between: Bubbles, Schedule and AI Chat."),
      },
  {
    id: "schedule", target: '[data-tour="schedule-view"]', tab: "schedule",
    title: t("Your schedule"),
    body: t("In the Schedule your tasks are placed by the hour automatically. To change a time, just write it to the AI chat."),
  },
  {
    id: "chat", target: '[data-tour="ai-chat"]', tab: "chat", interactive: true, pinTop: true,
    title: t("Artificial intelligence"),
    body: t("Artificial intelligence plans your day by text or voice. Try writing right now, for example: “Put the task at 4 PM”."),
  },
  {
    id: "profile", target: '[data-tour="profile-btn"]', tab: "bubbles", interactive: true, mandatory: true, advanceOnModal: "profile",
    title: t("Your profile"),
    body: t("Your profile is right here. Tap it to open the settings."),
  },
  {
    id: "account", tab: "bubbles", drawer: "profile", insideModal: true, union: true,
    target: '[data-tour-modal="profile"] [data-tour="profile-header"], [data-tour-modal="profile"] [data-tour="profile-notifications"]',
    title: t("Account and notifications"),
    body: t("In your profile you manage the account and turn on notifications for task starts and the timer ending."),
  },
  {
    id: "theme", target: '[data-tour="theme-toggle"], [data-tour="feedback-btn"]', union: true, tab: "bubbles",
    title: t("Theme and feedback"),
    body: t("Switch between the light and dark theme here, and send us an idea or a remark through “Feedback”."),
  },
  {
    id: "support", target: '[data-tour="support-btn"]', tab: "bubbles",
    title: t("Support us"),
    body: t("If the app is useful to you, support us with the “Support” button."),
  },
  {
    id: "help", target: '[data-tour="help-btn"]', tab: "bubbles",
    title: t("Replay any time"),
    body: t("If you forget something, tap “?” at any moment to go through the tutorial again."),
  },
];

type Box = { x: number; y: number; w: number; h: number };
const PAD = 8;

/**
 * Spotlight walkthrough over the real UI. It measures the target element (and keeps measuring on resize, scroll and
 * layout changes), dims everything else with a glowing cutout, and puts the tip card where it fits on screen, even on a
 * 375 px phone. `onSelectTab` switches the app's tab so each step's target is actually on screen.
 */
export function InteractiveTutorial({
  open, onClose, onSelectTab, bubbleCount, onSyncDialogs, createdTaskId, onSetProfileOpen,
}: {
  /** Put the app in the dialog state a step needs: the Create window (editing the tour's own task if it exists), the Task window, or none. */
  onSyncDialogs: (kind: "create" | "task" | null) => void;
  /** Id of the bubble created during this tutorial, if any. */
  createdTaskId: string | null;
  /** Open or close the profile drawer (used by the steps that point at controls inside it). */
  onSetProfileOpen: (open: boolean) => void;
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
    <AnimatePresence>{open && <Tour onClose={onClose} onSelectTab={onSelectTab} bubbleCount={bubbleCount} onSyncDialogs={onSyncDialogs} createdTaskId={createdTaskId} onSetProfileOpen={onSetProfileOpen} />}</AnimatePresence>,
    document.body,
  );
}

function Tour({ onClose, onSelectTab, bubbleCount, onSyncDialogs, createdTaskId, onSetProfileOpen }: { onClose: () => void; onSelectTab: (tab: TutorialTab) => void; bubbleCount: number; onSyncDialogs: (kind: "create" | "task" | null) => void; createdTaskId: string | null; onSetProfileOpen: (open: boolean) => void }) {
  const { t } = useLang();
  // The layout switches at Tailwind's lg (1024 px): that is where the canvas, Schedule and chat share the screen.
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const on = () => {
      setIsDesktop(window.matchMedia("(min-width: 1024px)").matches);
    };
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const list = useMemo(() => steps(t, isDesktop, !!createdTaskId), [t, isDesktop, createdTaskId]);

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
  // A step that waits for a dialog moves on the moment it OPENS. Coming back to such a step while the dialog is still
  // open (or closing) must not skip it again, so it is "armed" only after the dialog has been seen closed.
  const modalIdRef = useRef(modalId);
  useEffect(() => {
    modalIdRef.current = modalId;
  });
  const armed = useRef(true);
  useEffect(() => {
    armed.current = modalIdRef.current !== step.advanceOnModal;
  }, [i, step.advanceOnModal]);
  useEffect(() => {
    if (!step.advanceOnModal) return;
    if (modalId !== step.advanceOnModal) {
      armed.current = true;
      return;
    }
    if (!armed.current) return;
    const id = setTimeout(() => setI((n) => Math.min(n + 1, list.length - 1)), 350);
    return () => clearTimeout(id);
  }, [modalId, step.advanceOnModal, list.length]);
  // A step that waits for a dialog to close moves on the moment it does (not while it is still open).
  const sawModal = useRef(false);
  // The Create step also ends when the dialog closes after SAVING the tutorial's own bubble (no new bubble appears then).
  const closeId = step.advanceOnModalClose ?? (step.id === "submit" && createdTaskId ? "create" : undefined);
  useEffect(() => {
    if (!closeId) {
      sawModal.current = false;
      return;
    }
    if (modalId === closeId) sawModal.current = true;
    else if (sawModal.current || (modalId === null && step.id !== "submit")) setI((n) => Math.min(n + 1, list.length - 1));
  }, [modalId, closeId, list.length, step.id]);
  // Declarative dialog state: whenever the step changes (Next OR Back) the app is put in the state that step needs, so
  // stepping back reopens the Create window (on the tour's own task) or the Task window, and stepping on closes them.
  const needs = step.requires ?? null;
  useEffect(() => {
    onSyncDialogs(needs);
  }, [i, needs, onSyncDialogs]);

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
  const unionStep = !!step.union;
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
      const visible = target ? ([...document.querySelectorAll(target)] as HTMLElement[]).map((e) => e.getBoundingClientRect()).filter((b) => b.width > 1) : [];
      // One control, or (union steps) the bounding box of every listed control.
      const r = visible.length === 0 ? undefined : unionStep ? { left: Math.min(...visible.map((b) => b.left)), top: Math.min(...visible.map((b) => b.top)), width: Math.max(...visible.map((b) => b.right)) - Math.min(...visible.map((b) => b.left)), height: Math.max(...visible.map((b) => b.bottom)) - Math.min(...visible.map((b) => b.top)) } : visible[0];
      if (!r || r.width < 2 || r.height < 2) return setBox((b) => (b === null ? b : null));
      const next = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
      setBox((b) => (b && Math.abs(b.x - next.x) < 0.5 && Math.abs(b.y - next.y) < 0.5 && Math.abs(b.w - next.w) < 0.5 && Math.abs(b.h - next.h) < 0.5 ? b : next));
    };
    const el0 = target ? ([...document.querySelectorAll(target)] as HTMLElement[]).find((e) => e.getBoundingClientRect().width > 1) ?? null : null;
    el0?.scrollIntoView({ block: "nearest" });
    // A bubble on the canvas springs into place and drifts, so while a step points at one the rectangle is
    // re-measured every animation frame; other targets are still, so a slower tick is enough.
    const followsBubble = !!target && target.includes("tutorial-target-bubble");
    let raf = 0;
    const loop = () => {
      measure();
      raf = requestAnimationFrame(loop);
    };
    const first = followsBubble ? requestAnimationFrame(loop) : requestAnimationFrame(measure);
    const id = followsBubble ? undefined : setInterval(measure, 150);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(raf);
      if (id) clearInterval(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [target, unionStep]);
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
        if (handlers.current.mandatory) return; // (arrow keys only; Enter is never used)
        if (handlers.current.last) handlers.current.onClose();
        else setI((n) => n + 1);
      }
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const next = () => (last ? onClose() : setI((n) => n + 1));

  // Card position. Rule: the card docks on the edge OPPOSITE the target. A target in the upper half of the screen (the ✕ of
  // the task window, the header buttons) puts the card at the bottom; a target in the lower half puts it at the top. A final
  // collision guard flips the edge if the card would still touch the target (plus 16 px), so the target is always uncovered.
  const M = 12;
  const EDGE = 16;
  const phone = view.w < 768;
  const cardW = phone ? view.w - M * 2 : Math.min(360, view.w - M * 2);
  let dock: "top" | "bottom" | "free" = "free";
  let left = (view.w - cardW) / 2;
  let top = Math.max(M, (view.h - cardH) / 2); // no target: centred
  const wide = view.w >= 900;
  const besideModal = !!(step.insideModal && modalBox && wide && (modalBox.x + modalBox.w + M + cardW <= view.w || modalBox.x - M - cardW >= 0));
  if (box) {
    left = phone ? M : Math.min(Math.max(M, box.x + box.w / 2 - cardW / 2), view.w - cardW - M);
    dock = box.y + box.h / 2 < view.h * 0.5 ? "bottom" : "top";
  }
  if (step.pinTop) dock = "top"; // the chat step: the whole chat (messages, input, mic, send) stays visible and usable
  if (besideModal && modalBox && box) {
    // wide screens: next to the dialog, level with the target
    dock = "free";
    left = modalBox.x + modalBox.w + M + cardW <= view.w ? modalBox.x + modalBox.w + M : modalBox.x - M - cardW;
    top = Math.min(Math.max(M, box.y), Math.max(M, view.h - cardH - M));
  }
  const dockedTop = (d: "top" | "bottom") => (d === "top" ? EDGE : view.h - cardH - EDGE);
  if (dock !== "free" && box) {
    top = dockedTop(dock);
    const hits = (t0: number) =>
      left < box.x + box.w + EDGE && left + cardW > box.x - EDGE && t0 < box.y + box.h + EDGE && t0 + cardH > box.y - EDGE;
    if (hits(top) && !step.pinTop) {
      dock = dock === "top" ? "bottom" : "top"; // still touching: use the opposite edge
      top = dockedTop(dock);
    }
  }
  const cardStyle: React.CSSProperties =
    dock === "bottom"
      ? { bottom: `calc(${EDGE}px + env(safe-area-inset-bottom, 0px))`, left, width: cardW }
      : dock === "top"
        ? { top: `calc(${EDGE}px + env(safe-area-inset-top, 0px))`, left, width: cardW }
        : { top, left, width: cardW };

  return (
    <motion.div data-tour-card className="pointer-events-none fixed inset-0 z-[9999]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-label={t("Help")}>
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
        style={cardStyle}
      >
        <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
          <span>{t("Step {a} of {b}", { a: i + 1, b: list.length })}</span>
          {!last && (
            <button type="button" onClick={onClose} className="rounded-full px-2 py-1 transition hover:text-white">{step.mandatory ? t("Skip tutorial") : t("Skip")}</button>
          )}
        </div>
        <h2 className="text-base font-semibold tracking-tight">{step.title}</h2>
        {step.body && <p className="mt-1.5 text-sm leading-relaxed text-zinc-300">{step.body}</p>}
        {step.extra}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={() => setI((n) => Math.max(0, n - 1))} disabled={i === 0} aria-label={t("Back")}
            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/[0.08] disabled:opacity-30">
            ← {t("Back")}
          </button>
          {(!step.mandatory || (step.id === "submit" && !!createdTaskId)) && (
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
