export const MIN_DURATION = 1;
/** Technical ceiling only (9 999 h): in practice there is no cap on how long a task may be. */
export const MAX_DURATION = 9999 * 60;

/**
 * Hours + minutes fields → total minutes. Either may be blank (2 h → 120, 45 min → 45); both blank
 * (or zero) → undefined, which lets the AI estimate.
 */
export function totalMinutes(hours: string, minutes: string): number | undefined {
  const h = hours.trim() === "" ? 0 : Number(hours);
  const m = minutes.trim() === "" ? 0 : Number(minutes);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) return undefined;
  const total = Math.round(h * 60 + m);
  return total > 0 ? total : undefined;
}

/** Total minutes → hours / minutes field values ("" for a zero part). */
export function splitMinutes(total: number | undefined): { hours: string; minutes: string } {
  if (!total || total <= 0) return { hours: "", minutes: "" };
  const h = Math.floor(total / 60);
  const m = total % 60;
  return { hours: h ? String(h) : "", minutes: m ? String(m) : "" };
}

export const clampDuration = (min: number): number => Math.max(MIN_DURATION, Math.min(MAX_DURATION, min));
