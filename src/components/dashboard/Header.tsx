"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

export function Header({
  summary,
  name,
  photoURL,
  onOpenProfile,
  onSignOut,
}: {
  summary: string;
  name: string;
  photoURL?: string | null;
  onOpenProfile: () => void;
  onSignOut: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-background/70 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4">
        <div className="shrink-0">
          <Logo size={38} />
        </div>

        <p className="min-w-0 flex-1 truncate text-center text-xs text-muted sm:text-sm" aria-live="polite">
          {summary}
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label="Open profile"
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
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
