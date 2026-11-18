/**
 * Background music for a running task timer. One shared <audio> element loops /audio/task-music.mp3 at volume 0.45.
 * If the file isn't there yet, or the browser blocks autoplay, everything is swallowed: no thrown errors, no retries
 * in a loop. Muting keeps the track playing silently so un-muting is instant.
 */
const SRC = "/audio/task-music.mp3";
const VOLUME = 0.45;
const MUTE_KEY = "bs:musicMuted";

let audio: HTMLAudioElement | null = null;
let missing = false; // the file failed to load: stay quiet from now on
let wanted = false; // a timer is running, so the music should be playing
let muted = readMuted();
const listeners = new Set<() => void>();

function readMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

function element(): HTMLAudioElement | null {
  if (typeof window === "undefined" || missing) return null;
  if (!audio) {
    audio = new Audio(SRC);
    audio.loop = true;
    audio.volume = VOLUME;
    audio.preload = "auto";
    audio.muted = muted;
    audio.addEventListener("error", () => {
      missing = true; // 404 or undecodable: no music, no noise
      audio = null;
    });
  }
  return audio;
}

/** Start (or resume) the loop. Call it from the Start click so the browser allows sound. */
export function startTaskMusic(): void {
  wanted = true;
  const a = element();
  if (!a) return;
  a.muted = muted;
  a.volume = VOLUME;
  void a.play().catch(() => {
    // Autoplay blocked (e.g. after a reload): the next tap or key press will start it.
    const retry = () => {
      window.removeEventListener("pointerdown", retry);
      window.removeEventListener("keydown", retry);
      if (wanted) void audio?.play().catch(() => {});
    };
    window.addEventListener("pointerdown", retry, { once: true });
    window.addEventListener("keydown", retry, { once: true });
  });
}

/** Pause and rewind (timer paused, stopped, or the task completed). */
export function stopTaskMusic(): void {
  wanted = false;
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
    /* nothing playing */
  }
}

export const isMusicMuted = (): boolean => muted;

export function setMusicMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    /* storage blocked */
  }
  if (audio) audio.muted = next;
  listeners.forEach((l) => l());
}

export function subscribeMusicMuted(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
