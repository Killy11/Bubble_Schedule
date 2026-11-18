"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Chrome/Edge/Android fire `beforeinstallprompt`; it isn't in lib.dom yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface InstallContextValue {
  /** A native install prompt is available right now. */
  canInstall: boolean;
  /** Already running as an installed app (or just installed). */
  installed: boolean;
  /** iOS Safari has no programmatic prompt; show "Add to Home Screen" instructions instead. */
  isIOS: boolean;
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
}
const InstallContext = createContext<InstallContextValue | null>(null);

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Mounted at the root so the one-shot `beforeinstallprompt` event isn't missed before the profile opens. */
export function InstallProvider({ children }: { children: ReactNode }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault(); // keep it for our own button
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Initial environment checks run in a microtask, not synchronously in the effect body.
    queueMicrotask(() => {
      setInstalled(isStandalone());
      setIsIOS(/iphone|ipad|ipod/i.test(navigator.userAgent));
    });
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferred) return "unavailable" as const;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null); // a prompt event can be used only once
    if (outcome === "accepted") setInstalled(true);
    return outcome;
  }, [deferred]);

  const value = useMemo(
    () => ({ canInstall: !!deferred, installed, isIOS, install }),
    [deferred, installed, isIOS, install],
  );
  return <InstallContext.Provider value={value}>{children}</InstallContext.Provider>;
}

export function useInstall(): InstallContextValue {
  const ctx = useContext(InstallContext);
  if (!ctx) throw new Error("useInstall must be used inside <InstallProvider>");
  return ctx;
}
