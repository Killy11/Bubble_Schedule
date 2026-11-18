"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Undo2, X } from "lucide-react";
import { useLang } from "@/context/LanguageProvider";

export interface ToastInput {
  title: string;
  body?: string;
  /** Called when the toast body is clicked (e.g. navigate to the schedule). */
  onClick?: () => void;
  /** Optional button under the text (e.g. "Reschedule"). */
  action?: { label: string; onClick: () => void };
  /** How long it stays (default 7000). */
  durationMs?: number;
  /** "bottom" is used for Undo toasts so they sit near the thumb. */
  placement?: "top" | "bottom";
}
interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<{ toast: (t: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const { t: tr } = useLang();

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setItems((l) => [...l.slice(-4), { ...t, id }]);
      setTimeout(() => dismiss(id), t.durationMs ?? 7000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);

  const stack = (placement: "top" | "bottom") => {
    const bottom = placement === "bottom";
    return (
      <div
        aria-live="polite"
        className={`pointer-events-none fixed inset-x-3 z-[60] flex gap-2 ${
          bottom
            ? "bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+4.75rem)] flex-col-reverse items-center lg:bottom-6"
            : "top-[max(0.75rem,env(safe-area-inset-top))] flex-col items-center sm:items-end sm:pr-2"
        }`}
      >
        <AnimatePresence>
          {items
            .filter((t) => (t.placement ?? "top") === placement)
            .map((t) => (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: bottom ? 16 : -16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl bg-background/90 p-3 shadow-xl"
              >
                {bottom ? (
                  <Undo2 className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                ) : (
                  <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                )}
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() => {
                    t.onClick?.();
                    dismiss(t.id);
                  }}
                >
                  <p className="break-words text-sm font-medium">{t.title}</p>
                  {t.body && <p className="mt-0.5 break-words text-xs text-muted">{t.body}</p>}
                </button>
                {t.action && (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                    className="shrink-0 self-center rounded-full bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:opacity-90"
                  >
                    {t.action.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label={tr("Dismiss")}
                  className="shrink-0 rounded-full p-1 text-muted transition hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            ))}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {stack("top")}
      {stack("bottom")}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
