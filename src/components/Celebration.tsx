"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useLang } from "@/context/LanguageProvider";

const DURATION_MS = 3800;
const FIRE_AT = 0.45; // seconds after mount: the poppers go off
const FLOAT_S = 3.0; // how long the bubbles live after the bang
const LEAN_DEG = 38; // poppers point diagonally inward
const POPPER_MS = 2200; // slide in, fire, slide back out

const NEON = ["#22d3ee", "#a78bfa", "#f472b6", "#4ade80", "#facc15", "#38bdf8", "#fb7185"];
const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#facc15", "#22c55e", "#38bdf8", "#8b5cf6", "#ec4899", "#ffffff"];

/**
 * Popper size and how far it is tucked behind its corner. The offset hangs the base so far outside the
 * canvas that only the upper ~45–50% (cone and nozzle) peeks in at full extension; the base stays hidden.
 */
function popperLayout() {
  const phone = typeof window !== "undefined" && window.innerWidth < 640;
  const w = phone ? 96 : 144;
  const h = Math.round(w * 1.3);
  // Raised ~50px (desktop) / ~38px (phone) from before: the whole upper cone and nozzle now stand in the corner,
  // while the tip (the pivot, `off` px past both edges) stays hidden. Spawn points are derived from this same value.
  const off = Math.max(8, Math.round(h * 0.42) - (phone ? 38 : 50));
  return { w, h, off };
}

/** Rotating encouragement (keys are translated by the language provider). */
const MESSAGES = [
  "🎉 Bubble popped! Crushed it!",
  "✨ Nice one! Another bubble down!",
  "🚀 Great job! Keep the momentum!",
  "🏆 Task complete! You're on fire!",
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Popper {
  side: "left" | "right";
  w: number;
  h: number;
  off: number;
  /** Lean from vertical in degrees (CSS rotation: + clockwise). */
  theta: number;
  /** Where the bang comes out, in viewport pixels. */
  nozzle: { x: number; y: number };
}

function makePoppers(vw: number, vh: number): Popper[] {
  const { w, h, off } = popperLayout();
  const reach = h * 0.77; // pivot (the tip, hidden off-screen) → open mouth
  return ([["left", LEAN_DEG], ["right", -LEAN_DEG]] as const).map(([side, theta]) => {
    // The box hangs `off` px past the corner, so its base stays hidden and only the upper cone peeks in.
    const px = side === "left" ? -off + w / 2 : vw + off - w / 2;
    const py = vh + off;
    const rad = (theta * Math.PI) / 180;
    return { side, w, h, off, theta, nozzle: { x: px + reach * Math.sin(rad), y: py - reach * Math.cos(rad) } };
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
function PartyPopper({ uid, w, h }: { uid: string; w: number; h: number }) {
  return (
    <svg viewBox="0 0 100 130" width={w} height={h} aria-hidden>
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
  // Tucked behind its corner, it slides diagonally in, recoils as it fires, then slides back out.
  const hidden = { x: left ? -p.w : p.w, y: p.h };
  return (
    <motion.div
      className="absolute"
      style={{
        [left ? "left" : "right"]: -p.off,
        bottom: -p.off,
        width: p.w,
        height: p.h,
        transformOrigin: "50% 100%",
        rotate: p.theta,
      }}
      initial={hidden}
      animate={{ x: [hidden.x, 0, 0, hidden.x], y: [hidden.y, 0, 0, hidden.y] }}
      transition={{ duration: POPPER_MS / 1000, times: [0, 0.14, 0.82, 1], ease: ["backOut", "linear", "easeIn"] }}
    >
      {/* crisp kickback at the bang */}
      <motion.div
        style={{ transformOrigin: "50% 100%" }}
        animate={{
          scale: [1, 1, 0.86, 1.07, 1, 1],
          rotate: [0, 0, left ? -9 : 9, left ? 3 : -3, 0, 0],
          y: [0, 0, 12, -4, 0, 0], // backward nudge along the barrel
        }}
        transition={{ duration: 1.4, times: [0, FIRE_AT / 1.4, (FIRE_AT + 0.08) / 1.4, (FIRE_AT + 0.3) / 1.4, 0.8, 1], ease: "easeOut" }}
      >
        <PartyPopper uid={uid} w={p.w} h={p.h} />
      </motion.div>
    </motion.div>
  );
}

/** Celebration inside the bubble canvas: poppers tucked in its bottom corners, glossy bubbles, confetti, and a cheer badge. */
function Burst({ id, w, h, onDone }: { id: number; w: number; h: number; onDone: () => void }) {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [setup] = useState(() => {
    const poppers = makePoppers(w, h);
    return {
      vw: w,
      vh: h,
      poppers,
      flights: poppers.flatMap((p) => Array.from({ length: 16 }, () => flight(p))), // 32 bubbles
      message: MESSAGES[Math.floor(Math.random() * MESSAGES.length)],
    };
  });

  useEffect(() => {
    const done = setTimeout(onDone, DURATION_MS);
    return () => clearTimeout(done);
  }, [onDone]);

  // Confetti, ribbons and sparkles fired from each nozzle at the moment of the bang.
  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let shoot: ReturnType<typeof import("canvas-confetti").create> | null = null;
    void import("canvas-confetti").then(({ default: lib }) => {
      if (cancelled || !canvasRef.current) return;
      // Our own canvas, so the confetti is clipped to the bubble canvas instead of covering the whole window.
      const confetti = Object.assign(lib.create(canvasRef.current, { resize: true, disableForReducedMotion: true }), { shapeFromText: lib.shapeFromText });
      shoot = confetti;
      const base = { disableForReducedMotion: true, colors: CONFETTI_COLORS };
      const star = confetti.shapeFromText({ text: "✨", scalar: 2 });
      timers.push(
        setTimeout(() => {
          for (const p of setup.poppers) {
            const origin = { x: p.nozzle.x / setup.vw, y: p.nozzle.y / setup.vh };
            const angle = 90 - p.theta;
            confetti({ ...base, particleCount: 90, spread: 62, angle, origin, startVelocity: 72, gravity: 0.9, ticks: 280, scalar: 1.1 });
            confetti({ ...base, particleCount: 36, spread: 34, angle, origin, startVelocity: 88, gravity: 0.55, ticks: 340, scalar: 1.7, shapes: ["square"] }); // ribbons
            confetti({ ...base, particleCount: 14, spread: 70, angle, origin, startVelocity: 55, shapes: [star], scalar: 2, ticks: 260, colors: undefined });
          }
          // A shower over the whole screen.
          let n = 0;
          const rain = setInterval(() => {
            confetti({ ...base, particleCount: 7, angle: 270, spread: 130, startVelocity: 22, gravity: 0.7, ticks: 240, origin: { x: Math.random(), y: -0.05 } });
            if (++n >= 9) clearInterval(rain);
          }, 130);
          timers.push(setTimeout(() => clearInterval(rain), 1500));
        }, FIRE_AT * 1000),
      );
    });
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      shoot?.reset();
    };
  }, [reduced, setup]);

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
      <motion.div
        className="glass absolute left-1/2 top-[max(1rem,env(safe-area-inset-top))] -translate-x-1/2 whitespace-nowrap rounded-full bg-background/80 px-6 py-3 text-base font-semibold shadow-2xl"
        initial={{ y: -80, scale: 0.6, opacity: 0, rotate: -6 }}
        animate={{ y: [-80, 0, 0, -30], scale: [0.6, 1.08, 1, 0.9], opacity: [0, 1, 1, 0], rotate: [-6, 2, 0, 0] }}
        transition={{ duration: 3, delay: FIRE_AT, times: [0, 0.14, 0.82, 1], ease: "easeOut" }}
      >
        {t(setup.message)}
      </motion.div>
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
