"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Calendar, Check, Mic, Plus, Repeat, Sparkles } from "lucide-react";
import { Orb } from "@/components/Orb";
import { SupportButton } from "@/components/SupportButton";
import { useLang, type TFn } from "@/context/LanguageProvider";

interface Step {
  title: string;
  body: ReactNode;
  visual: ReactNode;
}

const steps = (t: TFn): Step[] => [
  {
    title: t("Colours show urgency"),
    body: (
      <>
        <b className="text-red-500">{t("Red")}</b>: {t("under 1 day")}. <b className="text-amber-500">{t("Yellow")}</b>: {t("1–5 days")}.{" "}
        <b className="text-green-500">{t("Green")}</b>: {t("5+ days or no deadline")}.
      </>
    ),
    visual: (
      <div className="flex items-end gap-4">
        <Orb hue="red" size={84} />
        <Orb hue="yellow" size={64} />
        <Orb hue="green" size={46} />
      </div>
    ),
  },
  {
    title: t("Type or speak a task"),
    body: t("Tap New bubble, use the chat, or the mic (UA / EN)."),
    visual: (
      <div className="flex items-center gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background"><Plus className="h-6 w-6" /></span>
        <span className="glass relative flex h-14 w-14 items-center justify-center rounded-full">
          <span className="absolute inset-0 animate-ping rounded-full bg-red-500/30" />
          <Mic className="relative h-6 w-6" />
        </span>
      </div>
    ),
  },
  {
    title: t("Pop a bubble to finish it"),
    body: t("Open a bubble and tap Complete."),
    visual: (
      <div className="relative">
        <Orb hue="green" size={72} />
        <span className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background"><Check className="h-4 w-4" /></span>
      </div>
    ),
  },
  {
    title: t("Repeat what repeats"),
    body: t("Daily, weekdays, weekly or custom days."),
    visual: <span className="glass flex h-16 w-16 items-center justify-center rounded-full"><Repeat className="h-7 w-7" /></span>,
  },
  {
    title: t("AI plans your day"),
    body: t("Missed deadlines move to Overdue in Schedule."),
    visual: (
      <div className="flex items-center gap-4">
        <span className="glass flex h-14 w-14 items-center justify-center rounded-full"><Sparkles className="h-6 w-6" /></span>
        <span className="glass flex h-14 w-14 items-center justify-center rounded-full"><Calendar className="h-6 w-6" /></span>
      </div>
    ),
  },
];

/** First-run walkthrough. `onClose` fires for both "Skip" and finishing; reopen it any time with the ? button. */
export function OnboardingTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  return <AnimatePresence>{open && <Tour onClose={onClose} />}</AnimatePresence>;
}

function Tour({ onClose }: { onClose: () => void }) {
  const { t } = useLang();
  const STEPS = steps(t);
  const [i, setI] = useState(0);
  const last = i === STEPS.length - 1;
  const step = STEPS[i];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Help")}
        className="glass max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-3xl bg-background/90 p-6 shadow-2xl"
      >
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span>{i + 1} / {STEPS.length}</span>
          <button type="button" onClick={onClose} className="rounded-full px-2 py-1 transition hover:text-foreground">
            {t("Skip")}
          </button>
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={i}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.2 }}
            className="flex min-h-[15rem] flex-col items-center text-center"
          >
            <div className="flex h-32 items-center justify-center">{step.visual}</div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">{step.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
          </motion.div>
        </AnimatePresence>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((_, n) => (
              <span key={n} className={`h-1.5 rounded-full transition-all ${n === i ? "w-5 bg-foreground" : "w-1.5 bg-line"}`} />
            ))}
          </div>
          <div className="flex gap-2">
            {i > 0 && (
              <button type="button" onClick={() => setI(i - 1)}
                className="glass rounded-full px-4 py-2 text-sm text-muted transition hover:text-foreground">
                {t("Back")}
              </button>
            )}
            <button type="button" autoFocus onClick={() => (last ? onClose() : setI(i + 1))}
              className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition hover:opacity-90">
              {last ? t("Get started") : t("Next")}
            </button>
          </div>
        </div>
        <div className="mt-4 flex justify-center border-t border-line pt-4">
          <SupportButton />
        </div>
      </div>
    </motion.div>
  );
}
