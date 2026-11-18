"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

const FIRE_AT = 0.45; // seconds after mount: the poppers go off
const FLOAT_S = 3.0; // how long the bubbles live after the bang
const POPPER_MS = 2200; // slide in, fire, slide back out

const NEON = ["#22d3ee", "#a78bfa", "#f472b6", "#4ade80", "#facc15", "#38bdf8", "#fb7185"];
const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#facc15", "#22c55e", "#38bdf8", "#8b5cf6", "#ec4899", "#ffffff"];

// ── Popper geometry ─────────────────────────────────────────────────────────────────────────────
// The SVG is drawn pointing straight UP: pointed tip at the bottom, open mouth at the top. Its box is square
// (viewBox -20 -14 140 144), with the tip at 50% / 97.9% of the box and the mouth centre at 50% / 31.9%.
const TIP = { x: 0.5, y: 0.979 };
const TIP_TO_MOUTH = 0.66; // × box size
const HIDE = 0.26; // the tip is tucked 26% of the box out past the bottom corner (translate ∓26%, +26%)
const MIN_LEAN_DEG = 38;
const MAX_LEAN_DEG = 42;

/** Popper box size: ~92px on phones, ~128px from 640px up. */
function popperSize() {
  return typeof window !== "undefined" && window.innerWidth < 640 ? 92 : 128;
}


const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Popper {
  side: "left" | "right";
  /** Box size in px (square). */
  size: number;
  /** Lean from vertical in degrees (CSS rotation: + clockwise). Exact mirror images. */
  theta: number;
  /** Where the bang comes out (the mouth), in canvas pixels. */
  nozzle: { x: number; y: number };
}

/**
 * Left popper in the exact bottom-left corner, right popper in the exact bottom-right, mirror images, both aimed
 * at the middle of the canvas (clamped to 38–42°). The nozzle is derived from the same numbers the CSS uses.
 */
function makePoppers(vw: number, vh: number): Popper[] {
  const size = popperSize();
  return ([["left", 1], ["right", -1]] as const).map(([side, dir]) => {
    // Tip position after the tuck: box corner + tip offset + (∓26%, +26%).
    const tipX = side === "left" ? (TIP.x - HIDE) * size : vw - size + (TIP.x + HIDE) * size;
    const tipY = vh - size + TIP.y * size + HIDE * size;
    const aim = (Math.atan2(Math.abs(vw * 0.5 - tipX), Math.max(1, tipY - vh * 0.4)) * 180) / Math.PI;
    const theta = dir * Math.min(MAX_LEAN_DEG, Math.max(MIN_LEAN_DEG, aim));
    const rad = (theta * Math.PI) / 180;
    const reach = TIP_TO_MOUTH * size;
    return { side, size, theta, nozzle: { x: tipX + reach * Math.sin(rad), y: tipY - reach * Math.cos(rad) } };
  });
}

interface Flight {
  x: number[];
  y: number[];
  scale: number[];
  opacity: number[];
  size: number;
  color: string;
  end: { x: number; y: number };
}

/**
 * One bubble's flight, integrated frame by frame: a fast burst out of the nozzle that decays with air
 * drag, then a buoyant upward float with a gentle sine wobble, ending in a pop. Sampled into keyframes.
 */
function flight(p: Popper): Flight {
  const dt = 1 / 40;
  const steps = Math.round(FLOAT_S / dt);
  const heading = ((p.theta + rand(-24, 24)) * Math.PI) / 180;
  const speed = rand(650, 1500);
  let vx = speed * Math.sin(heading);
  let vy = -speed * Math.cos(heading);
  const drag = rand(1.5, 2.6);
  const buoyancy = rand(70, 150); // px/s² upward
  const amp = rand(8, 28);
  const freq = rand(0.6, 1.2);
  const phase = rand(0, Math.PI * 2);
  const size = rand(14, 50);
  let bx = 0;
  let by = 0;
  const x: number[] = [];
  const y: number[] = [];
  const scale: number[] = [];
  const opacity: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    if (i % 2 === 0) {
      const wob = amp * Math.sin(2 * Math.PI * freq * t + phase) * (1 - Math.exp(-t * 1.5));
      x.push(p.nozzle.x + bx + wob);
      y.push(p.nozzle.y + by);
      const k = i / steps;
      scale.push(k < 0.06 ? 0.4 + (k / 0.06) * 0.6 : k > 0.93 ? 1 + ((k - 0.93) / 0.07) * 0.35 : 1);
      opacity.push(k > 0.95 ? 0 : k > 0.88 ? 0.5 : 1);
    }
    vx *= Math.exp(-drag * dt);
    vy = vy * Math.exp(-drag * dt) - buoyancy * dt;
    bx += vx * dt;
    by += vy * dt;
  }
  return { x, y, scale, opacity, size, color: NEON[Math.floor(Math.random() * NEON.length)], end: { x: x[x.length - 1], y: y[y.length - 1] } };
}

function Bubble3D({ f }: { f: Flight }) {
  const c = f.color;
  return (
    <motion.span
      aria-hidden
      className="absolute left-0 top-0 block rounded-full"
      style={{
        width: f.size,
        height: f.size,
        marginLeft: -f.size / 2,
        marginTop: -f.size / 2,
        border: `1.5px solid ${c}b3`,
        background: [
          "radial-gradient(circle at 30% 26%, rgba(255,255,255,0.95) 0 7%, rgba(255,255,255,0.3) 16%, transparent 38%)",
          `radial-gradient(circle at 72% 80%, ${c}59, transparent 52%)`,
          `radial-gradient(circle at 50% 50%, transparent 54%, ${c}40 74%, ${c}99 100%)`,
        ].join(","),
        boxShadow: `0 0 14px ${c}99, inset 0 0 ${Math.max(6, f.size / 4)}px ${c}66`,
        willChange: "transform, opacity",
      }}
      initial={{ opacity: 0, x: f.x[0], y: f.y[0], scale: 0.4 }}
      animate={{ x: f.x, y: f.y, scale: f.scale, opacity: f.opacity }}
      transition={{ duration: FLOAT_S, delay: FIRE_AT, ease: "linear" }}
    />
  );
}

/** A crisp party popper: striped cone, open mouth at the top, streamers and a star poking out. */
function PartyPopper({ uid, size }: { uid: string; size: number }) {
  return (
    <svg viewBox="-20 -14 140 144" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id={`${uid}-body`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#be123c" />
          <stop offset="0.45" stopColor="#fb7185" />
          <stop offset="1" stopColor="#9f1239" />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>
          <path d="M50 127 L10 32 Q50 44 90 32 Z" />
        </clipPath>
      </defs>
      {/* streamers and star */}
      <path d="M40 30 C 22 12, 34 2, 20 -6" fill="none" stroke="#22d3ee" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M50 30 C 56 10, 44 0, 52 -10" fill="none" stroke="#facc15" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M60 30 C 78 14, 66 2, 82 -4" fill="none" stroke="#a78bfa" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M50 8 l3 7 7 .6-5.4 4.6 1.8 7-6.4-4-6.4 4 1.8-7L40 15.6l7-.6z" fill="#fde047" stroke="#f59e0b" strokeWidth="1" />
      {/* cone */}
      <path d="M50 127 L10 32 Q50 44 90 32 Z" fill={`url(#${uid}-body)`} />
      <g clipPath={`url(#${uid}-clip)`}>
        {[0, 1, 2, 3, 4].map((i) => (
          <path key={i} d={`M ${-10 + i * 24} 60 L ${40 + i * 24} 140`} stroke={i % 2 ? "#facc15" : "#22d3ee"} strokeWidth="7" opacity="0.9" />
        ))}
        {[[36, 60], [62, 70], [48, 92], [54, 52], [42, 78]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="2.6" fill="#fff" opacity="0.85" />
        ))}
        <path d="M24 40 L46 118" stroke="#fff" strokeWidth="4" opacity="0.22" />
      </g>
      {/* mouth */}
      <ellipse cx="50" cy="32" rx="40" ry="9.5" fill="#fecdd3" stroke="#e11d48" strokeWidth="2.5" />
      <ellipse cx="50" cy="32" rx="30" ry="5.5" fill="#4c0519" />
    </svg>
  );
}

function PopperView({ p, uid }: { p: Popper; uid: string }) {
  const left = p.side === "left";
  const origin = `${TIP.x * 100}% ${TIP.y * 100}%`; // everything pivots on the pointed tip
  // Rest position: tip tucked 26% out past the corner. Hidden position: further out, so it slides in diagonally.
  const rest = { x: (left ? -HIDE : HIDE) * p.size, y: HIDE * p.size };
  const hidden = { x: (left ? -1 : 1) * p.size, y: p.size };
  return (
    <motion.div
      className="absolute bottom-0"
      style={{ [left ? "left" : "right"]: 0, width: p.size, height: p.size, transformOrigin: origin, rotate: p.theta }}
      initial={hidden}
      animate={{ x: [hidden.x, rest.x, rest.x, hidden.x], y: [hidden.y, rest.y, rest.y, hidden.y] }}
      transition={{ duration: POPPER_MS / 1000, times: [0, 0.14, 0.82, 1], ease: ["backOut", "linear", "easeIn"] }}
    >
      {/* crisp kickback at the bang */}
      <motion.div
        style={{ transformOrigin: origin }}
        animate={{
          scale: [1, 1, 0.9, 1.06, 1, 1],
          rotate: [0, 0, left ? -7 : 7, left ? 2 : -2, 0, 0],
          y: [0, 0, 8, -3, 0, 0], // backward nudge along the barrel
        }}
        transition={{ duration: 1.4, times: [0, FIRE_AT / 1.4, (FIRE_AT + 0.08) / 1.4, (FIRE_AT + 0.3) / 1.4, 0.8, 1], ease: "easeOut" }}
      >
        <PartyPopper uid={uid} size={p.size} />
      </motion.div>
    </motion.div>
  );
}

/** Celebration inside the bubble canvas: poppers tucked in its bottom corners, glossy bubbles and confetti. Purely visual. */
function Burst({ id, w, h, onDone }: { id: number; w: number; h: number; onDone: () => void }) {
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [setup] = useState(() => {
    const poppers = makePoppers(w, h);
    return {
      vw: w,
      vh: h,
      poppers,
      flights: poppers.flatMap((p) => Array.from({ length: 16 }, () => flight(p))), // 32 bubbles
    };
  });

  // The burst stays mounted until BOTH the bubbles have popped and every confetti piece has fallen out of the
  // bottom of the canvas (the poppers may retract long before that).
  useEffect(() => {
    if (reduced) {
      const id = setTimeout(onDone, 50);
      return () => clearTimeout(id);
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const flags = { dom: false, confetti: false };
    const tryDone = () => {
      if (!cancelled && flags.dom && flags.confetti) onDone();
    };
    timers.push(setTimeout(() => { flags.dom = true; tryDone(); }, (FIRE_AT + FLOAT_S + 0.6) * 1000));
    timers.push(setTimeout(() => { flags.dom = true; flags.confetti = true; tryDone(); }, 12_000)); // safety net

    let shoot: ReturnType<typeof import("canvas-confetti").create> | null = null;
    void import("canvas-confetti").then(({ default: lib }) => {
      if (cancelled || !canvasRef.current) return;
      // Our own canvas, so the confetti is clipped to the bubble canvas instead of covering the whole window.
      const confetti = Object.assign(lib.create(canvasRef.current, { resize: true, disableForReducedMotion: true }), { shapeFromText: lib.shapeFromText });
      shoot = confetti;
      const runs: Array<Promise<unknown> | null> = [];
      const fire = (o: Parameters<typeof confetti>[0]) => runs.push(confetti(o));
      // Pieces drop 3·gravity px per tick once the burst has slowed, so give each enough ticks to cross the whole
      // canvas height (plus the climb) before it expires: they fall to the bottom edge instead of vanishing mid-air.
      const GRAVITY = 1.3;
      const ticks = Math.min(560, Math.round((setup.vh + 700) / (GRAVITY * 3)) + 40);
      const base = { disableForReducedMotion: true, colors: CONFETTI_COLORS, gravity: GRAVITY, ticks, decay: 0.91 };
      const star = confetti.shapeFromText({ text: "✨", scalar: 2 });
      timers.push(
        setTimeout(() => {
          for (const p of setup.poppers) {
            const origin = { x: p.nozzle.x / setup.vw, y: p.nozzle.y / setup.vh };
            const angle = 90 - p.theta;
            const drift = p.theta > 0 ? 0.35 : -0.35; // gentle sideways flutter, outward from each popper
            fire({ ...base, particleCount: 90, spread: 62, angle, origin, startVelocity: 62, scalar: 1.1, drift });
            fire({ ...base, particleCount: 36, spread: 34, angle, origin, startVelocity: 72, scalar: 1.7, shapes: ["square"], drift }); // ribbons
            fire({ ...base, particleCount: 14, spread: 70, angle, origin, startVelocity: 50, shapes: [star], scalar: 2, colors: undefined, drift });
          }
          // A shower from the top of the canvas.
          let n = 0;
          const rain = setInterval(() => {
            fire({ ...base, particleCount: 7, angle: 270, spread: 130, startVelocity: 18, origin: { x: Math.random(), y: -0.05 } });
            if (++n >= 9) {
              clearInterval(rain);
              void Promise.allSettled(runs).then(() => { flags.confetti = true; tryDone(); }); // resolves once all have fallen
            }
          }, 130);
          timers.push(setTimeout(() => clearInterval(rain), 1600));
        }, FIRE_AT * 1000),
      );
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      shoot?.reset();
    };
  }, [reduced, setup, onDone]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {!reduced && (
        <>
          {setup.poppers.map((p) => <PopperView key={p.side} p={p} uid={`pp${id}${p.side}`} />)}
          {setup.flights.map((f, i) => <Bubble3D key={i} f={f} />)}
          {/* a soft sparkle where each bubble pops */}
          {setup.flights.map((f, i) => (
            <motion.span
              key={`s${i}`}
              className="absolute left-0 top-0 block rounded-full"
              style={{ width: f.size, height: f.size, marginLeft: -f.size / 2, marginTop: -f.size / 2, border: `2px solid ${f.color}`, boxShadow: `0 0 10px ${f.color}` }}
              initial={{ opacity: 0, x: f.end.x, y: f.end.y, scale: 0.6 }}
              animate={{ opacity: [0, 0.9, 0], scale: [0.6, 1.5, 2] }}
              transition={{ duration: 0.4, delay: FIRE_AT + FLOAT_S - 0.08, ease: "easeOut" }}
            />
          ))}
        </>
      )}
    </div>
  );
}

export interface BurstSpec {
  id: number;
  /** Size of the bubble canvas it plays in (px). */
  w: number;
  h: number;
}

/** Mount one <Burst> per spec. Render inside the (relative, overflow-hidden) bubble canvas container. */
export function Celebrations({ bursts, onDone }: { bursts: readonly BurstSpec[]; onDone: (id: number) => void }) {
  return (
    <>
      {bursts.map((b) => (
        <Burst key={b.id} id={b.id} w={b.w} h={b.h} onDone={() => onDone(b.id)} />
      ))}
    </>
  );
}
