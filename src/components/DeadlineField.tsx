"use client";

import { useLang } from "@/context/LanguageProvider";

const field =
  "glass w-full rounded-2xl px-4 py-2.5 text-sm outline-none transition focus:border-[rgb(var(--glow-a))] placeholder:text-muted disabled:opacity-40";

/** A deadline picker with a clear "No deadline" switch. Without a deadline the bubble is green and never overdue. */
export function DeadlineField({
  value,
  none,
  onValue,
  onNone,
}: {
  value: string; // datetime-local
  none: boolean;
  onValue: (v: string) => void;
  onNone: (none: boolean) => void;
}) {
  const { t } = useLang();
  return (
    <div className="text-xs text-muted">
      <div className="flex items-center justify-between">
        <span>{t("Deadline")}</span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={none}
            onChange={(e) => onNone(e.target.checked)}
            className="h-3.5 w-3.5 accent-[rgb(var(--glow-a))]"
          />
          {t("No deadline")}
        </label>
      </div>
      <input
        type="datetime-local"
        value={value}
        disabled={none}
        required={!none}
        onChange={(e) => onValue(e.target.value)}
        aria-label={t("Deadline")}
        className={`${field} mt-1 text-foreground`}
      />
    </div>
  );
}
