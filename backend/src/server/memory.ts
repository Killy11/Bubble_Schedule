/** The assistant's long-term memory about the user: a short list of permanent habits and preferences. */
export const MAX_MEMORY = 12;
const MAX_ITEM_CHARS = 140;

const norm = (s: string) => s.toLowerCase().replace(/[\s.,;:!?"'«»]+/g, " ").trim();

/** Clean one remembered item (single line, trimmed, capped). */
const clean = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_CHARS);

/**
 * Merge new items into the memory without duplicates (case and punctuation ignored), newest last. Beyond MAX_MEMORY the
 * oldest items are dropped. Returns the same array contents when nothing changed.
 */
export function mergeMemory(existing: readonly string[], additions: readonly unknown[]): string[] {
  const out = existing.map(clean).filter(Boolean);
  const seen = new Set(out.map(norm));
  for (const raw of additions) {
    const item = clean(raw);
    const key = norm(item);
    if (!item || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(-MAX_MEMORY);
}

export const sameMemory = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);
