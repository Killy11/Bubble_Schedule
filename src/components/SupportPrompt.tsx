"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useLang } from "@/context/LanguageProvider";

/** Friendly one-time ask for support. No title: just the message and two buttons. */
export function SupportPrompt({ open, onClose, onSupport }: { open: boolean; onClose: () => void; onSupport: () => void }) {
  const { t } = useLang();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("Support")}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 24, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
            className="glass relative w-full max-w-sm rounded-3xl bg-background/90 p-6 pt-8 text-center shadow-2xl"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label={t("Close")}
              className="absolute right-3 top-3 rounded-full p-1.5 text-muted transition hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
            <p className="text-sm leading-relaxed">
              {t("Hi! We are a young team developing this planner. We really need your support to grow the project, launch new features, and make BubbleSchedule even better for you.")}
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <button
                type="button"
                autoFocus
                onClick={onSupport}
                className="flex-1 rounded-full border border-rose-400/50 bg-rose-500/10 px-5 py-2.5 text-sm font-medium text-rose-500 transition hover:bg-rose-500/15 hover:shadow-[0_0_16px_rgb(251_113_133/0.45)] dark:text-rose-300"
              >
                {t("❤️ Support")}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="glass flex-1 rounded-full px-5 py-2.5 text-sm text-muted transition hover:text-foreground"
              >
                {t("Maybe later")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
