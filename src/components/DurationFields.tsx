"use client";

const box =
  "glass w-full rounded-2xl px-4 py-2.5 text-sm text-foreground outline-none transition focus:border-[rgb(var(--glow-a))] placeholder:text-muted";

/** Duration as two side-by-side fields, Hours and Minutes. Either can be left blank. */
export function DurationFields({
  hours,
  minutes,
  onHours,
  onMinutes,
  hint = true,
}: {
  hours: string;
  minutes: string;
  onHours: (v: string) => void;
  onMinutes: (v: string) => void;
  hint?: boolean;
}) {
  return (
    <div role="group" aria-label="Duration">
      <div className="flex gap-3">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Hours</span>
          <input type="number" inputMode="numeric" min={0} max={8} step={1} value={hours}
            onChange={(e) => onHours(e.target.value)} placeholder="0h" className={box} />
        </label>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Minutes</span>
          <input type="number" inputMode="numeric" min={0} step={5} value={minutes}
            onChange={(e) => onMinutes(e.target.value)} placeholder="0m" className={box} />
        </label>
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted">Leave blank for AI to guess</p>}
    </div>
  );
}
