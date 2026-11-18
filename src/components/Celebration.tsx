"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const COLORS = ["#f43f5e", "#f59e0b", "#facc15", "#22c55e", "#38bdf8", "#8b5cf6", "#ec4899"];
const DURATION_MS = 2400;

interface Piece {
  dx: number; // horizontal travel (px)
  peak: number; // how high it shoots (px)
  fall: number; // where it ends up relative to the origin (px)
  spin: number;
  size: number;
  color: string;
  delay: number;
  round: boolean;
}
interface Mini { dx: number; dy: number; size: number; delay: number }

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function makePieces(side: 1 | -1, n: number): Piece[] {
  // A party popper fires up and inwards; side = +1 is the left corner (shoots right), -1 the right one.
  return Array.from({ length: n }, () => ({
    dx: side * rand(40, 340),
    peak: rand(180, 420),
    fall: rand(-40, 120),
    spin: rand(-720, 720),
    size: rand(6, 11),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    delay: rand(0, 0.12),
    round: Math.random() < 0.3,
  }));
}

/** One celebration: two party poppers in the bottom corners, confetti, and mini bubbles popping outwards. */
function Burst({ onDone }: { onDone: () => void }) {
  // Randomness is generated once per burst, on mount.
  const [left] = useState(() => makePieces(1, 26));
  const [right] = useState(() => makePieces(-1, 26));
  const [minis] = useState<Mini[]>(() =>
    Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2 + rand(-0.2, 0.2);
      const r = rand(90, 220);
      return { dx: Math.cos(a) * r, dy: Math.sin(a) * r, size: rand(14, 34), delay: rand(0, 0.1) };
    }),
  );

  useEffect(() => {
    const id = setTimeout(onDone, DURATION_MS);
    return () => clearTimeout(id);
  }, [onDone]);

  const popper = (side: "left" | "right", pieces: Piece[]) => (
    <div className={`absolute bottom-0 ${side === "left" ? "left-[6%]" : "right-[6%]"}`}>
      <motion.span
        aria-hidden
        className="absolute bottom-0 block text-4xl"
        style={{ transform: side === "left" ? "scaleX(1)" : "scaleX(-1)", transformOrigin: "bottom" }}
        initial={{ scale: 0.6, rotate: 0 }}
        animate={{ scale: [0.6, 1.25, 1], rotate: [0, -12, 0] }}
        transition={{ duration: 0.5 }}
      >
        🎉
      </motion.span>
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="absolute bottom-6 block"
          style={{ width: p.size, height: p.round ? p.size : p.size * 0.5, background: p.color, borderRadius: p.round ? "50%" : 2 }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{
            x: [0, p.dx * 0.7, p.dx],
            y: [0, -p.peak, p.fall],
            rotate: p.spin,
            opacity: [1, 1, 0],
          }}
          transition={{ duration: 1.9, delay: p.delay, ease: ["easeOut", "easeIn"], times: [0, 0.45, 1] }}
        />
      ))}
    </div>
  );

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {popper("left", left)}
      {popper("right", right)}
      <div className="absolute left-1/2 top-[45%]">
        {minis.map((m, i) => (
          <motion.span
            key={i}
            className="absolute block rounded-full border border-white/60"
            style={{
              width: m.size,
              height: m.size,
              marginLeft: -m.size / 2,
              marginTop: -m.size / 2,
              background: "radial-gradient(circle at 30% 30%, rgb(255 255 255 / 0.85), rgb(125 211 252 / 0.35) 55%, rgb(167 139 250 / 0.25))",
            }}
            initial={{ x: 0, y: 0, scale: 0.2, opacity: 0.95 }}
            animate={{ x: m.dx, y: m.dy, scale: [0.2, 1, 1.35], opacity: [0.95, 0.9, 0] }}
            transition={{ duration: 1.1, delay: m.delay, ease: "easeOut", times: [0, 0.6, 1] }}
          />
        ))}
      </div>
    </div>
  );
}

/** Mount one <Burst> per `ids` entry; call `onDone(id)` to drop it when it finishes. */
export function Celebrations({ ids, onDone }: { ids: readonly number[]; onDone: (id: number) => void }) {
  return (
    <>
      {ids.map((id) => (
        <Burst key={id} onDone={() => onDone(id)} />
      ))}
    </>
  );
}
