import { PART_TARGET_MIN } from "@/lib/subtasks";

export interface Interval {
  start: number;
  end: number;
}
export interface Part {
  title: string;
  durationMin: number;
}

const round5 = (n: number) => Math.round(n / 5) * 5;

/** How many parts a task of `totalMin` is split into: what the user asked for, else about one per hour. */
export function partCount(totalMin: number, requested: number | undefined, max: number): number {
  if (requested) return Math.max(2, Math.min(max, requested));
  return Math.max(2, Math.min(max, Math.round(totalMin / PART_TARGET_MIN)));
}

/**
 * Clean up the model's parts: sensible titles, 15–120 min each, and a total that matches the task
 * (the model's durations are scaled to `totalMin`). With `exact`, anything but that many parts is
 * rejected so the caller can fall back to an even split.
 */
export function normalizeParts(
  raw: Array<{ title?: unknown; durationMin?: unknown }>,
  totalMin: number,
  max: number,
  exact?: number,
): Part[] {
  const parts = raw
    .slice(0, max)
    .map((p) => ({
      title: String(p.title ?? "").replace(/\s+/g, " ").trim().slice(0, 100),
      durationMin: Number(p.durationMin),
    }))
    .filter((p) => p.title && Number.isFinite(p.durationMin) && p.durationMin > 0);
  if (parts.length < 2 || (exact && parts.length !== exact)) return [];
  const sum = parts.reduce((s, p) => s + p.durationMin, 0);
  const k = totalMin / sum;
  return parts.map((p) => ({ title: p.title, durationMin: Math.max(15, Math.min(240, round5(p.durationMin * k))) }));
}

/** Plain split used when the AI is unavailable: `count` equal parts. */
export function fallbackParts(title: string, totalMin: number, count: number): Part[] {
  const each = Math.max(15, Math.min(240, round5(totalMin / count)));
  return Array.from({ length: count }, (_, i) => ({
    title: `${title.slice(0, 85)} (part ${i + 1}/${count})`,
    durationMin: each,
  }));
}
