"use client";

import { useState } from "react";
import { HelpCircle, Loader2, LogOut, MessageSquarePlus } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SupportButton } from "@/components/SupportButton";
import { useLang } from "@/context/LanguageProvider";

export function Header({
  summary,
  name,
  photoURL,
  onOpenProfile,
  onOpenHelp,
  onOpenFeedback,
  onSignOut,
}: {
  summary: string;
  name: string;
  photoURL?: string | null;
  onOpenProfile: () => void;
  onOpenHelp: () => void;
  onOpenFeedback: () => void;
  onSignOut: () => Promise<void>;
}) {
  const { t } = useLang();
  const [busy, setBusy] = useState(false);
  return (
    <header className="sticky top-0 z-30 w-full border-b border-line bg-background/70 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      {/* One strict row: fixed height (the logo is 34 px tall plus margin, so it can never reach the canvas below).
          In an installed Windows window with a title-bar overlay, env(titlebar-area-*) keeps it inside the safe area. */}
      <div className="mx-auto flex h-14 w-full max-w-[1600px] flex-nowrap items-center justify-between gap-3 px-4 pl-[max(1rem,env(titlebar-area-x,0px))] [min-height:max(3.5rem,env(titlebar-area-height,0px))]">
        <div className="flex h-full shrink-0 items-center">
          <Logo size={34} />
        </div>

        <p className="min-w-0 flex-1 truncate text-center text-xs text-muted sm:text-sm" aria-live="polite">
          {summary}
        </p>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <SupportButton />
          <button
            type="button"
            onClick={onOpenFeedback}
            aria-label={t("Feedback")}
            title={t("Feedback")}
            className="glass hidden h-9 items-center gap-1.5 rounded-full px-2.5 text-xs text-muted transition hover:text-foreground sm:flex" /* on phones Feedback lives in Profile */
          >
            <MessageSquarePlus className="h-4 w-4" />
            <span className="hidden xl:inline">{t("Feedback")}</span>
          </button>
          <button
            type="button"
            onClick={onOpenHelp}
            aria-label={t("Help")}
            title={t("Help")}
            className="glass flex h-9 w-9 items-center justify-center rounded-full text-muted transition hover:text-foreground"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <ThemeToggle />
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label={t("Profile")}
            title={name}
            className="glass flex h-9 items-center gap-2 rounded-full pl-1 pr-1 text-sm text-muted transition hover:text-foreground lg:pr-3"
          >
            {photoURL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoURL} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold text-foreground">
                {name[0]?.toUpperCase()}
              </span>
            )}
            <span className="hidden max-w-[140px] truncate lg:inline">{name}</span>
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              await onSignOut();
            }}
            disabled={busy}
            className="glass flex h-9 items-center gap-1.5 rounded-full px-3 text-xs text-muted transition hover:text-foreground disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{t("Sign out")}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
