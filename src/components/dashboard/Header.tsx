"use client";

import { HelpCircle, MessageSquarePlus } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SupportButton } from "@/components/SupportButton";
import { useLang } from "@/context/LanguageProvider";

export function Header({
  name,
  photoURL,
  onOpenProfile,
  onOpenHelp,
  onOpenFeedback,
}: {
  name: string;
  photoURL?: string | null;
  onOpenProfile: () => void;
  onOpenHelp: () => void;
  onOpenFeedback: () => void;
}) {
  const { t } = useLang();
  return (
    <header className="sticky top-0 z-30 w-full border-b border-line bg-background/70 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      {/* A full-width bar from edge to edge (no centred max-width wrapper), so on a wide desktop the logo sits flush left
          and the controls flush right. In an installed Windows window with a title-bar overlay, env(titlebar-area-*)
          keeps it inside the safe area. */}
      <div className="box-border flex h-14 w-full flex-nowrap items-center justify-between gap-3 px-4 pl-[max(1rem,env(titlebar-area-x,0px))] md:px-6 [min-height:max(3.5rem,env(titlebar-area-height,0px))]">
        <div className="flex h-full shrink-0 items-center gap-2.5">
          <Logo size={30} />
          <span className="hidden text-base font-semibold tracking-tight md:inline">BubbleSchedule</span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <SupportButton />
          <button
            type="button"
            onClick={onOpenFeedback}
            data-tour="feedback-btn"
            aria-label={t("Feedback")}
            title={t("Feedback")}
            className="glass flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs text-muted transition hover:text-foreground"
          >
            <MessageSquarePlus className="h-4 w-4" />
            <span className="hidden xl:inline">{t("Feedback")}</span>
          </button>
          <button
            type="button"
            onClick={onOpenHelp}
            data-tour="help-btn"
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
            data-tour="profile-btn"
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
        </div>
      </div>
    </header>
  );
}
