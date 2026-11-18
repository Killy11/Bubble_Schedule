"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Heart, X } from "lucide-react";
import { useLang } from "@/context/LanguageProvider";
import { SUPPORT_URL } from "@/lib/support";

const TEAM_MESSAGE =
  "Hi! We are a young team developing this planner. We really need your support to grow the project, launch new features, and make BubbleSchedule even better for you.";

const SupportContext = createContext<{ openSupport: () => void } | null>(null);

/** One Support / donation modal for the whole app: the header, Profile, Help and the welcome prompt all open it. */
export function SupportProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openSupport = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ openSupport }), [openSupport]);
  return (
    <SupportContext.Provider value={value}>
      {children}
      <SupportModal open={open} onClose={() => setOpen(false)} />
    </SupportContext.Provider>
  );
}

export function useSupport() {
  const ctx = useContext(SupportContext);
  if (!ctx) throw new Error("useSupport must be used inside <SupportProvider>");
  return ctx;
}

function SupportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-4 backdrop-blur-md"
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
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="relative max-h-[90dvh] w-full max-w-[440px] overflow-y-auto overscroll-contain rounded-[28px] border border-white/12 bg-[#111116]/90 p-7 text-center shadow-[0_24px_80px_rgba(0,0,0,0.75)] backdrop-blur-2xl sm:p-8"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: "radial-gradient(120% 60% at 50% -10%, rgb(244 63 94 / 0.15), transparent 60%), radial-gradient(70% 50% at 100% 100%, rgb(245 158 11 / 0.10), transparent 65%)" }}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label={t("Close")}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-rose-400/50"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="relative flex flex-col items-center">
              <div className="mb-5 mt-1 flex h-14 w-14 items-center justify-center rounded-full border border-rose-300/35 bg-gradient-to-br from-rose-500/25 via-pink-500/15 to-amber-400/15 shadow-[0_0_30px_rgba(244,63,94,0.35),inset_0_1px_4px_rgba(255,255,255,0.35)]">
                <Heart className="h-6 w-6 text-rose-400" fill="currentColor" aria-hidden />
              </div>
              <p className="mb-6 text-center text-[15.5px] leading-[1.65] text-zinc-100/95">
                {t(TEAM_MESSAGE).split("BubbleSchedule").map((chunk, i) => (
                  <span key={i}>
                    {i > 0 && <span className="font-medium text-white">BubbleSchedule</span>}
                    {chunk}
                  </span>
                ))}
              </p>
              <a
                href={SUPPORT_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onClose}
                className="w-full rounded-full border border-rose-400/45 bg-gradient-to-r from-rose-500/30 via-pink-500/25 to-amber-500/20 px-5 py-3 text-sm font-medium text-rose-50 shadow-[0_0_24px_-4px_rgba(244,63,94,0.45)] transition-all duration-200 hover:from-rose-500/40 hover:via-pink-500/35 hover:to-amber-500/30 hover:shadow-[0_0_30px_-2px_rgba(244,63,94,0.65)] focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/50 active:scale-[0.98]"
              >
                {t("❤️ Support via Monobank")}
              </a>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
