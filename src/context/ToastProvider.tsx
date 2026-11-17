"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, X } from "lucide-react";

export interface ToastInput {
  title: string;
  body?: string;
  /** Called when the toast body is clicked (e.g. navigate to the schedule). */
  onClick?: () => void;
}
interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<{ toast: (t: ToastInput) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setItems((l) => [...l.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), 7000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 sm:items-end sm:pr-2"
      >
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl bg-background/90 p-3 shadow-xl"
            >
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
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
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="shrink-0 rounded-full p-1 text-muted transition hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
