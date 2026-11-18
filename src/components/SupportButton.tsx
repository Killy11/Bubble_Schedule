"use client";

import { Heart } from "lucide-react";
import { useLang } from "@/context/LanguageProvider";
import { SUPPORT_URL } from "@/lib/support";

/** "♥ Support": opens the donation page in a new tab. `pill` is the compact header style, `block` the full-width one. */
export function SupportButton({ variant = "pill" }: { variant?: "pill" | "block" }) {
  const { t } = useLang();
  const base = "inline-flex items-center justify-center gap-1.5 font-medium transition";
  const style =
    variant === "pill"
      ? "h-9 rounded-full border border-rose-400/50 bg-rose-500/5 px-3 text-xs text-rose-500 hover:bg-rose-500/10 hover:shadow-[0_0_14px_rgb(251_113_133/0.5)] dark:text-rose-300"
      : "w-full rounded-full border border-rose-400/50 bg-rose-500/10 px-5 py-3 text-sm text-rose-500 hover:bg-rose-500/15 hover:shadow-[0_0_16px_rgb(251_113_133/0.45)] dark:text-rose-300";
  return (
    <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className={`${base} ${style}`}>
      <Heart className={variant === "pill" ? "h-3.5 w-3.5" : "h-4 w-4"} fill="currentColor" aria-hidden /> {t("Support")}
    </a>
  );
}
