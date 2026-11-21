"use client";

import { useMemo } from "react";
import { useTextMeasure } from "@/hooks/useTextMeasure";
import { fitBubbleText } from "@/lib/bubbles/textFit";

/**
 * Text inside an orb. The fit is computed for the orb's final diameter, then drawn in container-query
 * units (cqw), so the text scales together with the orb while it animates. Everything sits inside a
 * circular clip, so nothing can spill outside the orb whatever the text.
 */
export function BubbleText({
  title,
  diameter,
  subtitle,
  subtitleCompact,
}: {
  title: string;
  diameter: number;
  subtitle?: string;
  subtitleCompact?: string;
}) {
  const { measure } = useTextMeasure();
  const fit = useMemo(
    () => fitBubbleText({ text: title, diameter, measure, subtitle, subtitleCompact }),
    [title, diameter, subtitle, subtitleCompact, measure],
  );
  const u = (px: number) => `${(px / diameter) * 100}cqw`; // px at the final size → % of the orb's current width

  return (
    <div
      aria-hidden
      className="orb-text pointer-events-none absolute inset-0 select-none text-foreground"
      style={{ containerType: "size", clipPath: `circle(${(fit.safeRadius / diameter) * 100}% at 50% 50%)` }}
    >
      {fit.lines.map((l, i) => (
        <span
          key={i}
          className="absolute left-1/2 whitespace-nowrap text-center font-semibold"
          style={{ top: `calc(50% + ${u(l.top)})`, transform: "translateX(-50%)", fontSize: u(fit.fontSize), lineHeight: u(fit.lineHeight) }}
        >
          {l.text}
        </span>
      ))}
      {fit.sub && (
        <span
          className="absolute left-1/2 whitespace-nowrap text-center font-medium text-foreground/75"
          style={{ top: `calc(50% + ${u(fit.sub.top)})`, transform: "translateX(-50%)", fontSize: u(fit.sub.fontSize), lineHeight: u(fit.sub.lineHeight) }}
        >
          {fit.sub.text}
        </span>
      )}
    </div>
  );
}
