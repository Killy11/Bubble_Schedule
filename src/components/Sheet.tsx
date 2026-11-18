"use client";

import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useLang } from "@/context/LanguageProvider";
import { isTutorialActive } from "@/lib/tutorialLock";

/** Bottom sheet on mobile, centred card on desktop. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  tourId,
  closeTourId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Lets the guided tour recognise this dialog (e.g. "create", "task"). */
  tourId?: string;
  /** `data-tour` value for the ✕ close button, so the tour can point at it. */
  closeTourId?: string;
}) {
  const { t } = useLang();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !isTutorialActive() && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => { if (!isTutorialActive()) onClose(); }} // a running tutorial never lets a stray click close the dialog
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            data-tour-modal={tourId}
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            className="glass max-h-[90dvh] w-full max-w-md overflow-y-auto overscroll-contain rounded-t-3xl bg-background/90 p-6 shadow-2xl sm:rounded-3xl"
          >
            <div className="mb-4 flex items-start justify-between">
              <h2 className="min-w-0 break-words pr-3 text-lg font-semibold tracking-tight">{title}</h2>
              <button
                onClick={onClose}
                data-tour={closeTourId}
                aria-label={t("Close")}
                className="-mr-2 -mt-2 flex min-h-[44px] min-w-[44px] shrink-0 touch-manipulation items-center justify-center rounded-full text-muted transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
