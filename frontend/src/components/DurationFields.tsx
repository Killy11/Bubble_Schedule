"use client";

import { useLang } from "@/context/LanguageProvider";

const box =
  "glass w-full rounded-2xl px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-[rgb(var(--glow-a))]";

/** Kept for callers that round: durations are exact whole minutes now, so this only rounds fractions. */
export const snap5 = (min: number): number => Math.round(min);

/** Digits only, no leading zeros ("007" → "7"); "" stays "". */
const digits = (v: string): string => {
  const d = v.replace(/\D+/g, "").slice(0, 6);
  return d === "" ? "" : String(Number(d));
};

/**
 * Duration as two free numeric inputs: any number of hours (0+, no upper cap) and any exact number of minutes
 * (2, 7, 45, even 90: durationMin = hours * 60 + minutes). `allowBlank` leaves both empty = "let the AI guess";
 * `allowZero` (for "minutes left") lets the total be 0, otherwise callers enforce a 1-minute minimum.
 */
export function DurationFields({
  hours,
  minutes,
  onHours,
  onMinutes,
  hint = true,
  allowBlank = true,
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
  return (
    <div role="group" aria-label={t("Duration")}>
      <div className="flex gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
            aria-label={t("Hours")} placeholder={allowBlank ? "—" : "0"} value={hours}
            onChange={(e) => onHours(digits(e.target.value))}
            onFocus={(e) => e.target.select()}
            className={box}
          />
          <span className="text-xs text-muted">{t("h")}</span>
        </label>
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off"
            aria-label={t("Minutes")} placeholder={allowBlank ? "—" : "0"} value={minutes}
            onChange={(e) => onMinutes(digits(e.target.value))}
            onFocus={(e) => e.target.select()}
            className={box}
          />
          <span className="text-xs text-muted">{t("min")}</span>
        </label>
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted">{t("Blank = AI guesses")}</p>}
    </div>
  );
}
