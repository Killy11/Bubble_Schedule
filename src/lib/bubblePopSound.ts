/**
 * The completion sound. A custom file in /public/sounds (bubble-pop.mp3 | .m4a | .wav | .ogg) is preferred;
 * without one, a "Yay!" cheer with a chime is synthesized with the Web Audio API. Browser autoplay rules are respected: every
 * failure is swallowed, so a blocked or missing sound never throws.
 */
const FILE_TYPES = ["mp3", "m4a", "wav", "ogg"];
const VOLUME = 1.0;
const COOLDOWN_MS = 1200; // bulk or rapid completions make ONE cheer, and the cheer never overlaps itself

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

/**
 * A joyful "Yay!" in about 1.2 s: a bright C-major arpeggio chime (C5 E5 G5 C6) under a small crowd of
 * vocal-like voices (detuned saw + triangle through two formant filters gliding from "ee" to "ay", with vibrato)
 * plus a breathy band-passed noise cheer. Everything goes through a compressor so it is loud but never clips.
 */
function synthPop() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    void ctx.resume().catch(() => {});
    const c = ctx;
    const t0 = c.currentTime + 0.01;

    // Master: gain then a limiter-style compressor.
    const master = c.createGain();
    master.gain.value = 0.95;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 8;
    limiter.ratio.value = 14;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.15;
    master.connect(limiter).connect(c.destination);

    // Chime: quick major-triad arpeggio with a shimmering decay.
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const at = t0 + i * 0.075;
      for (const [type, mult, level] of [["sine", 1, 0.32], ["triangle", 2, 0.1]] as const) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = type;
        o.frequency.value = f * mult;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(level, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.75);
        o.connect(g).connect(master);
        o.start(at);
        o.stop(at + 0.8);
      }
    });

    // Cheer: several voices "ee" → "ay", each a little different.
    const cheerAt = t0 + 0.1;
    const cheerEnd = cheerAt + 1.05;
    for (let v = 0; v < 6; v++) {
      const base = 250 + Math.random() * 190; // child / crowd pitches
      const lag = Math.random() * 0.05;
      const src = [c.createOscillator(), c.createOscillator()];
      src[0].type = "sawtooth";
      src[1].type = "triangle";
      src[1].detune.value = 7 + Math.random() * 10;
      const vib = c.createOscillator();
      const vibGain = c.createGain();
      vib.frequency.value = 5.5 + Math.random() * 1.5;
      vibGain.gain.value = base * 0.025;
      vib.connect(vibGain);
      const mix = c.createGain();
      mix.gain.value = 0.5;
      const f1 = c.createBiquadFilter();
      const f2 = c.createBiquadFilter();
      f1.type = f2.type = "bandpass";
      f1.Q.value = 6;
      f2.Q.value = 9;
      f1.frequency.setValueAtTime(500, cheerAt + lag);
      f1.frequency.linearRampToValueAtTime(750, cheerAt + lag + 0.35);
      f2.frequency.setValueAtTime(1800, cheerAt + lag);
      f2.frequency.linearRampToValueAtTime(2200, cheerAt + lag + 0.35);
      const env = c.createGain();
      env.gain.setValueAtTime(0.0001, cheerAt + lag);
      env.gain.exponentialRampToValueAtTime(0.4, cheerAt + lag + 0.07);
      env.gain.setValueAtTime(0.4, cheerAt + lag + 0.5);
      env.gain.exponentialRampToValueAtTime(0.0001, cheerEnd);
      for (const o of src) {
        o.frequency.setValueAtTime(base, cheerAt + lag);
        o.frequency.linearRampToValueAtTime(base * 1.18, cheerAt + lag + 0.4); // the cheer lifts
        vibGain.connect(o.frequency);
        o.connect(mix);
        o.start(cheerAt + lag);
        o.stop(cheerEnd + 0.05);
      }
      vib.start(cheerAt + lag);
      vib.stop(cheerEnd + 0.05);
      mix.connect(f1);
      mix.connect(f2);
      f1.connect(env);
      f2.connect(env);
      env.connect(master);
    }

    // Breath: filtered noise riding the same envelope, for the crowd feel.
    const len = Math.floor(c.sampleRate * 1.1);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const noise = c.createBufferSource();
    noise.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1600, cheerAt);
    bp.frequency.linearRampToValueAtTime(2400, cheerAt + 0.4);
    bp.Q.value = 1.2;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, cheerAt);
    ng.gain.exponentialRampToValueAtTime(0.22, cheerAt + 0.06);
    ng.gain.exponentialRampToValueAtTime(0.0001, cheerEnd);
    noise.connect(bp).connect(ng).connect(master);
    noise.start(cheerAt);
  } catch {
    /* no audio available */
  }
}

/** Cut the sound off (e.g. the completion was undone). */
export function stopBubblePop(): void {
  try {
    custom?.pause();
    if (custom) custom.currentTime = 0;
    void ctx?.suspend().catch(() => {}); // the next pop resumes it
  } catch {
    /* nothing playing */
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

/** A clear three-note bell for "timer finished" (shares the audio context; every failure is swallowed). */
export function playTimerChime(): void {
  if (typeof window === "undefined") return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    void ctx.resume().catch(() => {});
    const c = ctx;
    const t0 = c.currentTime + 0.02;
    const master = c.createGain();
    master.gain.value = 0.8;
    master.connect(c.destination);
    [880, 1108.73, 1318.51].forEach((f, i) => {
      const at = t0 + i * 0.22;
      for (const [mult, level] of [[1, 0.4], [2.01, 0.12]] as const) {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = "sine";
        o.frequency.value = f * mult;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(level, at + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
        o.connect(g).connect(master);
        o.start(at);
        o.stop(at + 1.15);
      }
    });
  } catch {
    /* no audio available */
  }
}
