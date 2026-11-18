import type { Pacing, Task } from "@/types";

export const DEFAULT_PACING: Pacing = "balanced";
export const pacingOf = (t: Pick<Task, "pacing">): Pacing => t.pacing ?? DEFAULT_PACING;

export const PACING_META: Record<Pacing, { label: string; hint: string }> = {
  chill: {
    label: "Chill",
    hint: "Spread out, long breaks",
  },
  balanced: {
    label: "Balanced",
    hint: "Steady rhythm, short breaks",
  },
  locked: {
    label: "Locked-in",
    hint: "One unbroken block",
  },
};

// Note: JS `\b` doesn't work for Cyrillic, so these avoid word boundaries.
const CHILL_RE =
  /не\s*напруг\S*|не\s*напряг\S*|без\s+напруг\S*|не\s+поспіш\S*|на\s+розслаб\S*|спокійн\S*|на\s+кілька\s+днів|на\s+декілька\s+днів|з\s+перерв\S*\s+на\s+каву|chill|relax(ed)?|take\s+it\s+easy|no\s+rush|over\s+(a\s+)?few\s+days|slow(ly)?\s+pace/iu;
const LOCKED_RE =
  /все\s+підряд|усе\s+підряд|підряд|залокін\S*|на\s+локін|локін\S*|максимально\s+близько|без\s+перерв|back[\s-]*to[\s-]*back|locked[\s-]*in|lock[\s-]*in|non[\s-]*stop|in\s+one\s+(go|sitting)|no\s+breaks?/iu;

/** Pacing implied by what the user typed or said, or null. When both kinds of words appear, the first wins. */
export function detectPacing(text: string): Pacing | null {
  const chill = CHILL_RE.exec(text)?.index;
  const locked = LOCKED_RE.exec(text)?.index;
  if (chill === undefined && locked === undefined) return null;
  if (chill === undefined) return "locked";
  if (locked === undefined) return "chill";
  return locked <= chill ? "locked" : "chill";
}

const WORDS: Record<string, number> = {
  дві: 2, два: 2, три: 3, чотири: 4, "п'ять": 5, "п’ять": 5, пять: 5, шість: 6,
  two: 2, three: 3, four: 4, five: 5, six: 6,
};
const SPLIT_RE = new RegExp(
  "(?:розбий|розділи|розбити|поділи|поділити|split|break|divide)\\S*\\s+(?:цю\\s+|this\\s+)?(?:(?:таск|задач|завдан)\\S*\\s+|task\\s+|it\\s+)?(?:up\\s+)?(?:на|into)\\s+(\\d+|[\\p{L}'’]+)\\s+(?:част\\S*|parts?|steps?|sessions?|chunks?)",
  "iu",
);

/** "розбий цю таску на 3 частини" / "split it into 3 parts" → 3 (2–12), otherwise null. */
export function parseSplitRequest(text: string): number | null {
  const m = SPLIT_RE.exec(text);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1].toLowerCase()];
  return n && n >= 2 && n <= 12 ? n : null;
}
