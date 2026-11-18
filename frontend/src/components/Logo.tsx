import { Orb, type Hue } from "@/components/Orb";

/**
 * BubbleSchedule logo: three overlapping orbs spelling the syllables of "Schedule".
 *
 *            ( dul )            yellow: above & right of red, overlapping its top-right
 *   ( Sche )        ( e )       green: right of red, below yellow, overlapping its bottom-right
 *
 * `size` = diameter of the red orb in px; all geometry is a fraction of it.
 * Positions are [left, top] of each orb's box, in units of `size`.
 */
const ORBS: Array<{ text: string; hue: Hue; d: number; left: number; top: number; font: number }> = [
  { text: "Sche", hue: "red", d: 1, left: 0, top: 0.3, font: 0.29 },
  { text: "dul", hue: "yellow", d: 0.72, left: 0.58, top: 0, font: 0.27 },
  { text: "e", hue: "green", d: 0.52, left: 1.03, top: 0.45, font: 0.32 },
];

export function Logo({ size = 38 }: { size?: number }) {
  // Whole-pixel geometry. With fractional sizes (38 × 1.3 = 49.4 px) Windows at 125% / 150% display scaling rounds
  // each orb differently, so the logo's glow and orbs could poke out past the box and over the content below.
  const px = (n: number) => Math.round(n);
  const boxW = Math.ceil(Math.max(...ORBS.map((o) => size * (o.left + o.d))));
  const boxH = Math.ceil(Math.max(...ORBS.map((o) => size * (o.top + o.d))));
  return (
    // isolate: the orbs blend with each other where they overlap, never with the page
    <div
      role="img"
      aria-label="BubbleSchedule"
      className="logo relative block shrink-0 bg-transparent"
      style={{ width: boxW, height: boxH, minWidth: boxW, minHeight: boxH }}
    >
      {ORBS.map((o) => (
        <div
          key={o.text}
          aria-hidden
          className="absolute"
          style={{ width: px(size * o.d), height: px(size * o.d), left: px(size * o.left), top: px(size * o.top) }}
        >
          {/* blended glass sphere */}
          <Orb hue={o.hue} className="logo-orb absolute inset-0" />
          {/* label: absolutely filled and flex-centred on both axes, above the blend layer */}
          <span
            className="logo-text absolute inset-0 flex select-none items-center justify-center whitespace-nowrap text-center leading-none"
            style={{ fontSize: Math.round(size * o.font) }}
          >
            {o.text}
          </span>
        </div>
      ))}
    </div>
  );
}
