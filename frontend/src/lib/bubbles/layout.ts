export interface BubbleSpec {
  id: string;
  d: number; // diameter
  weight: number; // higher = closer to the centre
}
export interface BubblePlacement {
  id: string;
  x: number; // top-left
  y: number;
  d: number;
}

const GAP = 10;
const PAD = 8;
const GOLDEN = 2.399963;

/**
 * Centre-outward packing. Bubbles are ranked by weight; the heaviest goes in the middle and
 * each next one takes the closest free spot on an expanding spiral of rings (elliptical, to use
 * the canvas aspect ratio).
 *
 * Overcrowding: ONE global scale factor applies to every bubble. It starts at 1 (capped so the
 * bubbles never cover more than ~55% of the canvas) and, if they still don't fit, is binary-
 * searched down to the largest value that does, so all bubbles shrink proportionally together.
 * Deterministic, so positions only change when rankings or sizes do.
 */
/** Diameter of the permanent "+" bubble in the middle of the canvas (px). Never scaled. */
export const ADD_BUBBLE_D = 80;

export function layoutBubbles(items: BubbleSpec[], w: number, h: number): BubblePlacement[] {
  if (!items.length || w < 40 || h < 40) return [];
  const ordered = [...items].sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
  const area = ordered.reduce((s, b) => s + Math.PI * (b.d / 2) ** 2, 0);

  const hi = Math.min(1, Math.sqrt((0.55 * w * h) / area)); // comfortable-density cap
  const first = pack(ordered, hi, w, h);
  if (first.complete) return first.placed;

  let lo = 0.08;
  let hiS = hi;
  let best = pack(ordered, lo, w, h); // last resort, even if partial
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hiS) / 2;
    const r = pack(ordered, mid, w, h);
    if (r.complete) { lo = mid; best = r; } else hiS = mid;
  }
  return best.placed;
}

function pack(items: BubbleSpec[], scale: number, w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const sx = w >= h ? Math.min(w / h, 1.8) : 1;
  const sy = h > w ? Math.min(h / w, 1.8) : 1;
  const maxRho = Math.hypot(w, h) / 2;
  // The "+" bubble is an immovable anchor at the centre: every task bubble packs around it, so none can cover it.
  const anchor = { id: "__add__", x: cx, y: cy, r: ADD_BUBBLE_D / 2 };
  const placed: Array<{ id: string; x: number; y: number; r: number }> = [anchor];

  const fits = (x: number, y: number, r: number) =>
    x - r >= PAD && x + r <= w - PAD && y - r >= PAD && y + r <= h - PAD &&
    placed.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + GAP);

  for (let i = 0; i < items.length; i++) {
    const r = (items[i].d * scale) / 2;
    let spot: { x: number; y: number } | null = null;
    for (let rho = placed[0].r + r + GAP; rho <= maxRho * 1.6 && !spot; rho += 4) {
      const n = Math.max(16, Math.ceil((2 * Math.PI * rho) / 14));
      const a0 = i * GOLDEN; // rotate the start angle so the spiral spreads evenly
      for (let k = 0; k < n; k++) {
        const t = a0 + (k * 2 * Math.PI) / n;
        const x = cx + rho * Math.cos(t) * sx;
        const y = cy + rho * Math.sin(t) * sy;
        if (fits(x, y, r)) { spot = { x, y }; break; }
      }
    }
    if (!spot) return { placed: toPlacements(placed), complete: false };
    placed.push({ id: items[i].id, ...spot, r });
  }
  return { placed: toPlacements(placed), complete: true };
}

const toPlacements = (p: Array<{ id: string; x: number; y: number; r: number }>): BubblePlacement[] =>
  p.filter((n) => n.id !== "__add__").map((n) => ({ id: n.id, x: n.x - n.r, y: n.y - n.r, d: n.r * 2 }));
