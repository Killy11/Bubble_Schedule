import type { HistoryRecord } from "@/types";
import { formatDuration } from "@/lib/subtasks";

/** Words that carry no meaning for matching tasks (English + Ukrainian). */
const STOP = new Set(
  ("a an the to of for and or in on at my your with from by do be is are " +
    "і й та або в у на до з із зі від по за для при про це мій моя моє мої").split(" "),
);

const tokens = (title: string): string[] => title.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** Lower-cased words joined by single spaces. */
export const normalizeTitle = (title: string): string => tokens(title).join(" ");

/** Distinct word stems (first 4 letters), so "report"/"reports" and "звіт"/"звіту" match. */
export function keywordsOf(title: string): string[] {
  const stems = tokens(title)
    .filter((t) => !STOP.has(t) && (t.length > 1 || /\d/.test(t)))
    .map((t) => (t.length > 4 ? t.slice(0, 4) : t));
  return [...new Set(stems)];
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const set = new Set(b);
  const inter = a.filter((x) => set.has(x)).length;
  return inter / (a.length + b.length - inter);
}

export interface DurationSuggestion {
  /** Suggested duration, rounded to 5 minutes. */
  minutes: number;
  samples: number;
  /** Weighted average of the matching tasks' actual minutes, unrounded. */
  avgActual: number;
}

const MIN_SIMILARITY = 0.5;
const MAX_SAMPLES = 10;

/** Suggest a duration from similar tasks the user finished before. Null when nothing matches well. */
export function suggestDuration(title: string, records: readonly HistoryRecord[]): DurationSuggestion | null {
  const kw = keywordsOf(title);
  const norm = normalizeTitle(title);
  if (!kw.length) return null;
  const matches = records
    .filter((r) => r.actualMin > 0)
    .map((r) => ({ r, s: r.normalizedTitle === norm ? 1 : jaccard(kw, r.keywords ?? []) }))
    .filter((m) => m.s >= MIN_SIMILARITY)
    .sort((a, b) => b.s - a.s || b.r.completedAt.localeCompare(a.r.completedAt))
    .slice(0, MAX_SAMPLES);
  if (!matches.length) return null;
  const weight = matches.reduce((sum, m) => sum + m.s, 0);
  const avg = matches.reduce((sum, m) => sum + m.s * m.r.actualMin, 0) / weight;
  return {
    minutes: Math.max(5, Math.min(480, Math.round(avg / 5) * 5)),
    samples: matches.length,
    avgActual: Math.round(avg),
  };
}

export function describeSuggestion(s: DurationSuggestion): string {
  return `Based on ${s.samples} similar task${s.samples > 1 ? "s" : ""} you finished (avg ${formatDuration(s.avgActual)})`;
}

/** Build the record stored when a task is completed. */
export function makeHistoryRecord(
  task: { id: string; title: string; durationMin?: number; aiEstimate?: { durationMin?: number } },
  actualMin: number,
  completedAt: string,
): HistoryRecord {
  const estimated = task.durationMin ?? task.aiEstimate?.durationMin;
  return {
    id: task.id,
    title: task.title,
    normalizedTitle: normalizeTitle(task.title),
    keywords: keywordsOf(task.title),
    ...(estimated ? { estimatedMin: estimated } : {}),
    actualMin,
    completedAt,
  };
}
