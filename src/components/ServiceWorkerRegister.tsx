"use client";

import { useEffect } from "react";

/** Registers the app service worker (installability + offline). Production only, so dev HMR is never cached. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" }) // always re-check sw.js for updates
        .catch(() => {});
    }
  }, []);
  return null;
}
