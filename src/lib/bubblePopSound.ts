/**
 * The bubble pop sound. A custom file in /public/sounds (bubble-pop.mp3 | .m4a | .wav | .ogg) is preferred;
 * without one, a short pop is synthesized with the Web Audio API. Browser autoplay rules are respected: every
 * failure is swallowed, so a blocked or missing sound never throws.
 */
const FILE_TYPES = ["mp3", "m4a", "wav", "ogg"];
const VOLUME = 0.75;
const COOLDOWN_MS = 500; // bulk or rapid completions make ONE pop, not a pile of overlapping ones

let lastPlayed = 0;
let custom: HTMLAudioElement | null = null;
let probe: Promise<void> | null = null;
let ctx: AudioContext | null = null;

/** Look for a custom file once and preload it (cheap HEAD requests; a missing file is just a 404). */
export function preloadBubblePop(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  return (probe ??= (async () => {
    for (const ext of FILE_TYPES) {
      const src = `/sounds/bubble-pop.${ext}`;
      try {
        const res = await fetch(src, { method: "HEAD" });
        if (res.ok && (res.headers.get("content-type") ?? "").startsWith("audio")) {
          const el = new Audio(src);
          el.preload = "auto";
          el.volume = VOLUME;
          el.addEventListener("error", () => { if (custom === el) custom = null; }); // a broken file falls back to the synth
          custom = el;
          return;
        }
      } catch {
        /* offline: use the synth */
      }
    }
  })());
}

function synthPop() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;

    // Body: a fast downward pitch sweep.
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(950, t0);
    osc.frequency.exponentialRampToValueAtTime(170, t0 + 0.09);
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.55 * VOLUME, t0 + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    osc.connect(og).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.13);

    // Snap: a very short filtered noise burst.
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.35 * VOLUME, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
    noise.connect(hp).connect(ng).connect(ctx.destination);
    noise.start(t0);
  } catch {
    /* no audio available */
  }
}

/** Play the pop (once per cooldown window). Call from a user action so the browser allows sound. */
export function playBubblePop(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (now - lastPlayed < COOLDOWN_MS) return;
  lastPlayed = now;
  if (custom) {
    try {
      custom.currentTime = 0;
      custom.volume = VOLUME;
      void custom.play().catch(() => {}); // NotAllowedError / AbortError: stay silent
      return;
    } catch {
      custom = null;
    }
  }
  synthPop();
}
