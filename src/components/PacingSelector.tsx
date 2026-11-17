"use client";

import { Coffee, Lock, Waves } from "lucide-react";
import { PACING_META } from "@/lib/pacing";
import type { Pacing } from "@/types";

const OPTIONS: Array<{ id: Pacing; icon: typeof Coffee }> = [
  { id: "chill", icon: Coffee },
  { id: "balanced", icon: Waves },
  { id: "locked", icon: Lock },
];

/** Chill / Balanced / Locked-in. `compact` drops the hint line. */
export function PacingSelector({
  value,
  onChange,
  compact,
  note,
}: {
  value: Pacing;
  onChange: (p: Pacing) => void;
  compact?: boolean;
  /** Small line under the control (e.g. "Detected from your text"). */
  note?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div role="radiogroup" aria-label="Focus intensity" className="glass flex rounded-full p-1">
        {OPTIONS.map(({ id, icon: Icon }) => {
          const on = value === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(id)}
              title={PACING_META[id].hint}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs transition ${
                on ? "bg-foreground font-medium text-background" : "text-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {PACING_META[id].label}
            </button>
          );
        })}
      </div>
      {!compact && <p className="text-[11px] leading-snug text-muted">{PACING_META[value].hint}</p>}
      {note && <p className="text-[11px] text-[rgb(var(--glow-a))]">{note}</p>}
    </div>
  );
}
