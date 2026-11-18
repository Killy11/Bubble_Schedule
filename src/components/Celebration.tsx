"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useLang } from "@/context/LanguageProvider";

const DURATION_MS = 3800;
const FIRE_AT = 0.45; // seconds after mount: the poppers go off
const FLOAT_S = 3.0; // how long the bubbles live after the bang
const POPPER_W = 140;
const POPPER_H = 182;
const LEAN_DEG = 32; // poppers point diagonally inward
const NEON = ["#22d3ee", "#a78bfa", "#f472b6", "#4ade80", "#facc15", "#38bdf8", "#fb7185"];
const CONFETTI_COLORS = ["#f43f5e", "#f59e0b", "#facc15", "#22c55e", "#38bdf8", "#8b5cf6", "#ec4899", "#ffffff"];

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
  /** Lean from vertical in degrees (CSS rotation: + clockwise). */
  theta: number;
  /** Where the bang comes out, in viewport pixels. */
  nozzle: { x: number; y: number };
}

function makePoppers(vw: number, vh: number): Popper[] {
  const margin = 10;
  const reach = POPPER_H * 0.77; // pivot (the tip) → mouth
  return ([["left", LEAN_DEG], ["right", -LEAN_DEG]] as const).map(([side, theta]) => {
    const px = side === "left" ? margin + POPPER_W / 2 : vw - margin - POPPER_W / 2;
    const rad = (theta * Math.PI) / 180;
    return { side, theta, nozzle: { x: px + reach * Math.sin(rad), y: vh - reach * Math.cos(rad) } };
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
function PartyPopper({ uid }: { uid: string }) {
  return (
    <svg viewBox="0 0 100 130" width={POPPER_W} height={POPPER_H} aria-hidden>
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
  return (
    <motion.div
      className="absolute bottom-0"
      style={{
        [left ? "left" : "right"]: 10,
        width: POPPER_W,
        height: POPPER_H,
        transformOrigin: "50% 100%",
        rotate: p.theta,
      }}
      initial={{ y: POPPER_H, scale: 0.5, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 18 }}
    >
      {/* recoil at the bang, then a clean fade-out */}
      <motion.div
        style={{ transformOrigin: "50% 100%" }}
        animate={{
          scale: [1, 1, 0.86, 1.07, 1, 1],
          rotate: [0, 0, left ? -9 : 9, left ? 3 : -3, 0, 0],
          y: [0, 0, 12, -4, 0, 0],
          opacity: [1, 1, 1, 1, 1, 0],
        }}
        transition={{ duration: 2.6, times: [0, FIRE_AT / 2.6, (FIRE_AT + 0.08) / 2.6, (FIRE_AT + 0.3) / 2.6, 0.62, 1], ease: "easeOut" }}
      >
        <PartyPopper uid={uid} />
      </motion.div>
    </motion.div>
  );
}

/** Full-screen celebration: two large poppers, glossy bubbles erupting from them, confetti, and a cheer badge. */
function Burst({ id, onDone }: { id: number; onDone: () => void }) {
  const { t } = useLang();
  const reduced = useReducedMotion();
  const [setup] = useState(() => {
    const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
    const vh = typeof window === "undefined" ? 800 : window.innerHeight;
    const poppers = makePoppers(vw, vh);
    return {
      vw,
      vh,
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
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return;
      const base = { zIndex: 55, disableForReducedMotion: true, colors: CONFETTI_COLORS };
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
    };
  }, [reduced, setup]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[55] h-screen w-screen overflow-hidden">
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

/** Mount one <Burst> per id; `onDone(id)` drops it when it finishes. */
export function Celebrations({ ids, onDone }: { ids: readonly number[]; onDone: (id: number) => void }) {
  return (
    <>
      {ids.map((id) => (
        <Burst key={id} id={id} onDone={() => onDone(id)} />
      ))}
    </>
  );
}
