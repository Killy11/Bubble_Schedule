/**
 * Fit text inside a circle.
 *
 * Pure geometry + a caller-supplied `measure(text, fontSizePx, weight)`, so it is testable without a DOM.
 *
 * Behaviour, in order:
 *  1. Try font sizes from large to MIN. At each size, try 1, 2, 3… lines. Every line may only be as wide
 *     as the circle's chord at that line's position (narrower near the top and bottom), and words are
 *     never split. The first size/line-count where ALL the text fits wins ("dynamic scaling").
 *  2. If nothing fits at MIN, truncate at MIN: fill lines with whole words only (never cram another word
 *     onto a line that is full), end with "…", and shorten a single word with "…" only if that word alone
 *     is wider than its line.
 *  3. A subtitle (deadline) is always kept: its font shrinks first, then the title is truncated (whole words).
 */
export interface FitLine {
  text: string;
  /** px from the circle centre to the TOP of this line (negative = above centre) */
  top: number;
}
export interface FitResult {
  fontSize: number;
  lineHeight: number;
  lines: FitLine[];
  sub?: { text: string; fontSize: number; lineHeight: number; top: number };
  truncated: boolean;
  /** radius (px) of the safe circle everything is guaranteed to lie inside */
  safeRadius: number;
}
export type Measure = (text: string, fontSizePx: number, weight?: number) => number;

export interface FitOptions {
  text: string;
  /** orb diameter in px */
  diameter: number;
  measure: Measure;
  subtitle?: string;
  /** Shorter form of the subtitle ("22.11 22:00"), used when the full one cannot fit a small orb. */
  subtitleCompact?: string;
  minFont?: number;
  maxFont?: number;
  /** safe circle as a fraction of the radius; the rest is margin for the rim and glow */
  safeRatio?: number;
}

const ELLIPSIS = "…";
const LINE_HEIGHT = 1.15;
const SUB_FONT = 11;
const SUB_GAP = 2;
const PAD = 4; // px kept free inside each line's chord

const chord = (rs: number, farY: number) => (farY >= rs ? 0 : 2 * Math.sqrt(rs * rs - farY * farY) - PAD);

interface Geometry {
  ok: boolean;
  limits: number[]; // max width of each title line
  tops: number[]; // top of each title line, from centre
  sub?: { top: number; limit: number };
  height: number;
}

/** Positions and widths available for `lines` title lines (+ optional subtitle) centred on the circle. */
function geometry(lines: number, lh: number, rs: number, sub: boolean, minLimit: number, subFont = SUB_FONT): Geometry {
  const subH = sub ? subFont * LINE_HEIGHT : 0;
  const height = lines * lh + (sub ? SUB_GAP + subH : 0);
  const start = -height / 2;
  const limits: number[] = [];
  const tops: number[] = [];
  for (let i = 0; i < lines; i++) {
    const top = start + i * lh;
    limits.push(chord(rs, Math.max(Math.abs(top), Math.abs(top + lh))));
    tops.push(top);
  }
  let subInfo: Geometry["sub"];
  if (sub) {
    const top = start + lines * lh + SUB_GAP;
    subInfo = { top, limit: chord(rs, Math.max(Math.abs(top), Math.abs(top + subH))) };
  }
  const ok = limits.every((l) => l >= minLimit) && (!subInfo || subInfo.limit > 0);
  return { ok, limits, tops, sub: subInfo, height };
}

/** Greedy wrap into exactly the given line limits; null unless ALL words are placed whole. */
function wrapAll(words: string[], fs: number, limits: number[], measure: Measure): string[] | null {
  const lines: string[] = [];
  let i = 0;
  for (const limit of limits) {
    let cur = "";
    while (i < words.length) {
      const cand = cur ? `${cur} ${words[i]}` : words[i];
      if (measure(cand, fs) > limit) break;
      cur = cand;
      i++;
    }
    if (!cur) return null; // the next word is wider than this line
    lines.push(cur);
    if (i === words.length) return lines;
  }
  return i === words.length ? lines : null;
}

/** Cut `s` from the end until `s + "…"` fits in `limit`. */
function cutToFit(s: string, fs: number, limit: number, measure: Measure): string {
  let out = s;
  while (out && measure(out + ELLIPSIS, fs) > limit) out = out.slice(0, -1);
  return (out.trimEnd() + ELLIPSIS).slice(0, out ? undefined : ELLIPSIS.length);
}

/** Fill the lines with whole words, then end with "…". Never crams a word that doesn't fit. */
function wrapTruncated(words: string[], fs: number, limits: number[], measure: Measure): string[] {
  const lines: string[] = [];
  let i = 0;
  for (let n = 0; n < limits.length && i < words.length; n++) {
    const limit = limits[n];
    let cur = "";
    while (i < words.length) {
      const cand = cur ? `${cur} ${words[i]}` : words[i];
      if (measure(cand, fs) > limit) break;
      cur = cand;
      i++;
    }
    if (!cur) {
      // Even one word doesn't fit this line at the minimum size: shorten that word, stop here.
      lines.push(cutToFit(words[i], fs, limit, measure));
      return lines;
    }
    lines.push(cur);
  }
  if (i < words.length) {
    // More text remains: put the ellipsis on the last line, dropping trailing words until it fits.
    const n = lines.length - 1;
    const limit = limits[n];
    const parts = lines[n].split(" ");
    while (parts.length > 1 && measure(parts.join(" ") + ELLIPSIS, fs) > limit) parts.pop();
    lines[n] = cutToFit(parts.join(" "), fs, limit, measure);
  }
  return lines;
}

function attempt(o: Required<Pick<FitOptions, "text" | "diameter" | "measure">> & { words: string[]; rs: number; min: number; max: number }, withSub: boolean, sub?: string, subFont = SUB_FONT): FitResult {
  const { words, rs, min, max, measure } = o;
  const subFits = (g: Geometry) =>
    !g.sub || measure(sub ?? "", subFont, 500) <= g.sub.limit;

  // 1. Largest font where everything fits as whole words.
  for (let fs = max; fs >= min - 1e-6; fs -= 0.5) {
    const lh = fs * LINE_HEIGHT;
    for (let lines = 1; ; lines++) {
      const g = geometry(lines, lh, rs, withSub, fs * 1.6, subFont);
      if (!g.ok || !subFits(g)) break; // more lines only make the block taller
      const wrapped = wrapAll(words, fs, g.limits, measure);
      if (wrapped) {
        return {
          fontSize: fs, lineHeight: lh, safeRadius: rs, truncated: false,
          lines: wrapped.map((text, i) => ({ text, top: g.tops[i] })),
          sub: g.sub && sub ? { text: sub, fontSize: subFont, lineHeight: subFont * LINE_HEIGHT, top: g.sub.top } : undefined,
        };
      }
    }
  }

  // 2. Doesn't fit even at the minimum size: truncate at the minimum size. Try every line count and
  //    keep the best by word priority: first word shown whole > more whole words > more characters.
  //    (A single centred line is widest, so a long lone word survives longer than in a tall block.)
  const fs = min;
  const lh = fs * LINE_HEIGHT;
  let bestScore: number[] | null = null;
  let best: { g: Geometry; lines: string[] } | null = null;
  for (let n = 1; ; n++) {
    const g = geometry(n, lh, rs, withSub, n === 1 ? 0 : fs * 1.6, subFont);
    if (!g.ok || (n > 1 && !subFits(g))) break;
    const lines = wrapTruncated(words, fs, g.limits, measure);
    const shown = lines.join(" ").replace(ELLIPSIS, "").trim().split(" ").filter(Boolean);
    const wholeWords = shown.filter((w, i) => w === words[i]).length;
    const score = [words[0] && shown[0] === words[0] ? 1 : 0, wholeWords, shown.join("").length];
    const better =
      !bestScore ||
      score[0] > bestScore[0] ||
      (score[0] === bestScore[0] && (score[1] > bestScore[1] || (score[1] === bestScore[1] && score[2] > bestScore[2])));
    if (better) { bestScore = score; best = { g, lines }; }
  }
  if (!best) { // circle smaller than one line: still return something contained
    const g = geometry(1, lh, rs, false, 0);
    best = { g, lines: wrapTruncated(words, fs, g.limits, measure) };
  }
  return {
    fontSize: fs, lineHeight: lh, safeRadius: rs, truncated: true,
    lines: best.lines.map((text, i) => ({ text, top: best.g.tops[i] })),
    sub: best.g.sub && sub && subFits(best.g)
      ? { text: sub, fontSize: subFont, lineHeight: subFont * LINE_HEIGHT, top: best.g.sub.top }
      : undefined,
  };
}

export function fitBubbleText(opts: FitOptions): FitResult {
  const { diameter, measure, subtitle } = opts;
  const rs = (diameter / 2) * (opts.safeRatio ?? 0.84);
  const min = opts.minFont ?? 11;
  const max = Math.max(min, opts.maxFont ?? Math.min(20, Math.max(12, diameter / 7)));
  const words = opts.text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const base = { text: opts.text, diameter, measure, words, rs, min, max };
  if (!words.length) return { fontSize: min, lineHeight: min * LINE_HEIGHT, lines: [], truncated: false, safeRadius: rs };

  if (subtitle) {
    // The deadline is always shown: first at the normal size without cutting the title, then smaller, and only then
    // with a (whole-word) truncated title. It is dropped only when the orb is too small to hold any text line plus it.
    const forms = opts.subtitleCompact && opts.subtitleCompact !== subtitle ? [subtitle, opts.subtitleCompact] : [subtitle];
    for (const form of forms) {
      for (const f of [SUB_FONT, 9.5, 8.5]) {
        const withSub = attempt(base, true, form, f);
        if (!withSub.truncated && withSub.sub) return withSub;
      }
    }
    for (const form of forms) {
      const last = attempt(base, true, form, 8.5);
      if (last.sub) return last;
    }
  }
  return attempt(base, false); // title only: the title always wins over the subtitle
}
