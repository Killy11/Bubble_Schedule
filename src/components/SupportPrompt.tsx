"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Heart, X } from "lucide-react";
import { isTutorialActive } from "@/lib/tutorialLock";
import { useLang } from "@/context/LanguageProvider";

const MESSAGE =
  "Hi! We are a young team developing this planner. We really need your support to grow the project, launch new features, and make BubbleSchedule even better for you.";

/** Friendly one-time ask for support. No text heading: a small glowing bubble-heart, the message, two buttons. */
export function SupportPrompt({ open, onClose, onSupport }: { open: boolean; onClose: () => void; onSupport: () => void }) {
  const { t } = useLang();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The brand name stands out in either language.
  const parts = t(MESSAGE).split("BubbleSchedule");

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-4 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: "easeOut" }}
          onClick={() => { if (!isTutorialActive()) onClose(); }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("Support")}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="relative max-h-[90dvh] w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-[28px] border border-white/12 bg-[#111116]/90 p-7 shadow-[0_24px_80px_rgba(0,0,0,0.75)] outline-none backdrop-blur-2xl sm:p-8"
          >
            {/* ambient glow and specular rim */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(120% 60% at 50% -10%, rgb(244 63 94 / 0.15), transparent 60%), radial-gradient(70% 50% at 100% 100%, rgb(245 158 11 / 0.10), transparent 65%)",
              }}
            />
            <div aria-hidden className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-rose-300/40 to-transparent" />

            <button
              type="button"
              onClick={onClose}
              aria-label={t("Close")}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-rose-400/50"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative flex flex-col items-center">
              {/* glass bubble-heart emblem with two drifting micro-bubbles */}
              <div className="relative mb-5 mt-1">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border border-rose-300/35 bg-gradient-to-br from-rose-500/25 via-pink-500/15 to-amber-400/15 shadow-[0_0_30px_rgba(244,63,94,0.35),inset_0_1px_4px_rgba(255,255,255,0.35)]">
                  <Heart className="h-6 w-6 text-rose-400 drop-shadow-[0_0_8px_rgba(251,113,133,0.9)]" fill="currentColor" aria-hidden />
                </div>
                <motion.span
                  aria-hidden
                  className="absolute -left-4 -top-2 h-3 w-3 rounded-full border border-rose-200/40 bg-gradient-to-br from-white/30 to-rose-400/10"
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
                />
                <motion.span
                  aria-hidden
                  className="absolute -bottom-1 -right-3 h-2 w-2 rounded-full border border-amber-200/40 bg-gradient-to-br from-white/30 to-amber-400/10"
                  animate={{ y: [0, 4, 0] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
                />
              </div>

              <p className="text-center text-[15.5px] font-normal leading-[1.65] tracking-[-0.01em] text-zinc-100/95 sm:text-[16px]">
                {parts.map((chunk, i) => (
                  <span key={i}>
                    {i > 0 && <span className="font-medium text-white">BubbleSchedule</span>}
                    {chunk}
                  </span>
                ))}
              </p>

              <div className="mt-6 flex w-full flex-col gap-2.5 sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={onSupport}
                  className="flex-1 rounded-full border border-rose-400/45 bg-gradient-to-r from-rose-500/30 via-pink-500/25 to-amber-500/20 px-5 py-3 text-sm font-medium text-rose-50 shadow-[0_0_24px_-4px_rgba(244,63,94,0.45)] transition-all duration-200 hover:from-rose-500/40 hover:via-pink-500/35 hover:to-amber-500/30 hover:shadow-[0_0_30px_-2px_rgba(244,63,94,0.65)] focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 active:scale-[0.98]"
                >
                  {t("❤️ Support")}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-full border border-white/10 bg-white/[0.04] px-5 py-3 text-sm font-normal text-zinc-400 transition-all duration-200 hover:bg-white/[0.08] hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50"
                >
                  {t("Maybe later")}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
