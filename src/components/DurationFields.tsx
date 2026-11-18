"use client";

import { useLang } from "@/context/LanguageProvider";

const box =
  "glass w-full appearance-none rounded-2xl px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-[rgb(var(--glow-a))]";

const HOURS = Array.from({ length: 13 }, (_, i) => i); // 0–12 h
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0, 5, … 55 min

/** Round to the nearest 5 minutes (what the dropdowns can show). */
export const snap5 = (min: number): number => Math.round(min / 5) * 5;

/**
 * Duration as two dropdowns: hours (0–12) and minutes in 5-minute steps. Because nothing is typed, the browser can
 * never reject a value ("the two nearest valid values are…"). A duration of 0 h 0 min is raised to 15 min, so a
 * task can't end up with no time; `allowZero` (for "minutes left") lifts that. `allowBlank` adds a "—" option that
 * means "let the AI guess" (both blank).
 */
export function DurationFields({
  hours,
  minutes,
  onHours,
  onMinutes,
  hint = true,
  allowBlank = true,
  allowZero = false,
}: {
  hours: string;
  minutes: string;
  onHours: (v: string) => void;
  onMinutes: (v: string) => void;
  hint?: boolean;
  allowBlank?: boolean;
  allowZero?: boolean;
}) {
  const { t } = useLang();
  const bothBlank = hours === "" && minutes === "";
  // A blank half next to a filled half just means 0.
  const h = hours === "" ? (bothBlank && allowBlank ? "" : "0") : hours;
  const m = minutes === "" ? (bothBlank && allowBlank ? "" : "0") : minutes;
  return (
    <div role="group" aria-label={t("Duration")}>
      <div className="flex gap-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("Hours")}</span>
          <select
            value={h}
            onChange={(e) => {
              const v = e.target.value;
              onHours(v);
              if (!allowZero && v === "0" && m === "0") onMinutes("15");
            }}
            className={box}
          >
            {allowBlank && <option value="">—</option>}
            {HOURS.map((n) => <option key={n} value={String(n)}>{t("{n} h", { n })}</option>)}
          </select>
        </label>
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("Minutes")}</span>
          <select
            value={m}
            onChange={(e) => {
              const v = e.target.value;
              onMinutes(v);
              if (!allowZero && v === "0" && h === "0") onMinutes("15");
            }}
            className={box}
          >
            {allowBlank && <option value="">—</option>}
            {MINUTES.map((n) => <option key={n} value={String(n)}>{t("{n} min", { n })}</option>)}
          </select>
        </label>
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted">{t("Blank = AI guesses")}</p>}
    </div>
  );
}
