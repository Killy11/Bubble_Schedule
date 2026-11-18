"use client";

import { useEffect, useState } from "react";

/** Current time in ms, refreshed every second while `active` (otherwise it only reads the clock once). */
export function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
