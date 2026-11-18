"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { UK } from "@/lib/i18n/uk";

export type Lang = "en" | "uk";
const KEY = "bs:lang";
const EVENT = "bs-lang-change";

// localStorage is the source of truth on this device (English by default); the profile mirrors it.
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}
function read(): Lang {
  try {
    return localStorage.getItem(KEY) === "uk" ? "uk" : "en";
  } catch {
    return "en";
  }
}

export type TFn = (en: string, vars?: Record<string, string | number>) => string;

interface LangValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translate an English UI string; unknown strings stay English. `{name}` placeholders are filled from vars. */
  t: TFn;
}
const Ctx = createContext<LangValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribe, read, () => "en" as Lang);

  const setLang = useCallback((l: Lang) => {
    try {
      localStorage.setItem(KEY, l);
    } catch {}
    document.documentElement.lang = l;
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const t = useCallback<TFn>(
    (en, vars) => {
      const s = lang === "uk" ? (UK[en] ?? en) : en;
      return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? "")) : s;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLang(): LangValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLang must be used inside <LanguageProvider>");
  return v;
}
