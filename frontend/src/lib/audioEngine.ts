/**
 * One shared Web Audio context for the whole app. Mobile browsers (iOS Safari, Android Chrome) create it
 * "suspended" and only let it run after a user gesture, so it is resumed (and a silent buffer played, which iOS needs)
 * inside the first taps / key presses and again inside every Start / Music tap. Later sounds, such as the timer-finished
 * chime that fires from a timer callback with no gesture, then play through the already running context.
 * Nothing here throws: no audio support simply means silence.
 */
let ctx: AudioContext | null = null;
let listening = false;

type ACtor = typeof AudioContext;
const ctor = (): ACtor | null =>
  typeof window === "undefined" ? null : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: ACtor }).webkitAudioContext ?? null);

/** The shared context (created on first use), or null when the browser has no Web Audio. */
export function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const AC = ctor();
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    return null;
  }
  return ctx;
}

/** Call synchronously inside a click / tap handler. */
export function unlockAudio(): void {
  const c = audioContext();
  if (!c) return;
  try {
    if (c.state !== "running") void c.resume().catch(() => {});
    // A one-sample silent buffer: the classic iOS unlock.
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
  } catch {
    /* ignore */
  }
}

/** Unlock on the very first gestures of the page, so even a chime that fires later (no tap at that moment) is audible. */
export function armAudioUnlock(): void {
  if (typeof window === "undefined" || listening) return;
  listening = true;
  const events = ["pointerdown", "touchend", "click", "keydown"] as const;
  const handler = () => {
    unlockAudio();
    if (ctx?.state === "running") events.forEach((e) => window.removeEventListener(e, handler, true));
  };
  events.forEach((e) => window.addEventListener(e, handler, { capture: true, passive: true }));
}
