"use client";

import { useEffect, useMemo, useState } from "react";
import type { Measure } from "@/lib/bubbles/textFit";

// Width cache shared by all bubbles. Cleared when web fonts finish loading (metrics change).
const widthCache = new Map<string, number>();
let canvasCtx: CanvasRenderingContext2D | null | undefined;

/** Width of `text` in the page's font via a canvas, with a small safety margin. */
function measureWidth(text: string, size: number, weight: number, family: string): number {
  const key = `${family}|${weight}|${size}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (canvasCtx === undefined) canvasCtx = document.createElement("canvas").getContext("2d");
  let w: number;
  if (canvasCtx) {
    canvasCtx.font = `${weight} ${size}px ${family}`;
    w = canvasCtx.measureText(text).width * 1.03 + 0.5;
  } else {
    w = text.length * size * 0.6; // no canvas available: conservative estimate
  }
  widthCache.set(key, w);
  return w;
}

/**
 * Text measurement using the page's real font. Returns a `measure` function and bumps its identity
 * once web fonts finish loading, so memoised text fits recompute with the true metrics. The circular
 * clip in <BubbleText> remains the hard guarantee that nothing spills.
 */
export function useTextMeasure(): { measure: Measure } {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => {
      if (!alive) return;
      widthCache.clear();
      setVersion((v) => v + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  const measure = useMemo<Measure>(() => {
    // Server render: no DOM, use a conservative estimate (the client re-fits with real metrics).
    if (typeof document === "undefined") return (text, size) => text.length * size * 0.6;
    const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
    return (text, size, weight = 600) => measureWidth(text, size, weight, family);
    // `version` is the trigger: new function identity after fonts load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return { measure };
}
