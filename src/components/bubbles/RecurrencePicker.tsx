"use client";

import type { Recurrence } from "@/types";
import { DAY_LABELS, recurrenceDays } from "@/lib/recurrence";

type Kind = "none" | Recurrence["type"];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

const field =
  "glass w-full rounded-2xl px-4 py-2.5 text-sm outline-none transition focus:border-[rgb(var(--glow-a))]";

/** Repeat selector: None / Daily / Weekdays / Weekly / Custom days. Controlled by the parent. */
export function RecurrencePicker({
  value,
  onChange,
  anchorDow,
  disabled,
}: {
  value: Recurrence | null;
  onChange: (next: Recurrence | null) => void;
  /** Weekday (0–6) the task's deadline falls on: "Weekly" repeats on it and Custom starts with it. */
  anchorDow: number;
  disabled?: boolean;
}) {
  const kind: Kind = value?.type ?? "none";
  const days = value?.type === "custom" ? recurrenceDays(value, anchorDow) : [];

  function pick(k: Kind) {
    if (k === "none") onChange(null);
    else if (k === "custom") onChange({ type: "custom", days: [anchorDow] });
    else onChange({ type: k });
  }
  function toggle(d: number) {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    if (next.length > 0) onChange({ type: "custom", days: next }); // always keep at least one day
  }

  return (
    <div className="space-y-2">
      <select
        value={kind}
        disabled={disabled}
        onChange={(e) => pick(e.target.value as Kind)}
        aria-label="Repeat"
        className={field}
      >
        <option value="none">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekdays">Weekdays (Mon–Fri)</option>
        <option value="weekly">Weekly ({DAY_LABELS[anchorDow]})</option>
        <option value="custom">Custom days…</option>
      </select>
      {kind === "custom" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Repeat on">
          {MON_FIRST.map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                disabled={disabled}
                onClick={() => toggle(d)}
                aria-pressed={on}
                className={`h-8 min-w-10 rounded-full px-2.5 text-xs transition ${
                  on ? "bg-foreground text-background" : "glass text-muted hover:text-foreground"
                }`}
              >
                {DAY_LABELS[d]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
