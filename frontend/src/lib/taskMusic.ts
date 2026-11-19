/**
 * Background music for a running task timer, built to work on phones:
 *  - the shared Web Audio context is unlocked synchronously inside the Start / Music tap (iOS Safari, Android Chrome);
 *  - /audio/task-music.mp3 is used when that file exists (a HEAD check at load), otherwise a generated, offline focus
 *    soundscape (lib/ambientSound.ts) plays, so there is always sound and never a 404 or an autoplay exception;
 *  - muting keeps everything running silently so un-muting is instant; pause / stop / unmount tear it all down.
 */
import { armAudioUnlock, unlockAudio } from "@/lib/audioEngine";
import { startAmbient, type Ambient } from "@/lib/ambientSound";

const SRC = "/audio/task-music.mp3";
const VOLUME = 0.45;
const MUTE_KEY = "bs:musicMuted";

let audio: HTMLAudioElement | null = null;
let ambient: Ambient | null = null;
let fileOk: boolean | null = null; // null = not checked yet
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

// Check once whether a real track was added, and arm the first-gesture audio unlock.
if (typeof window !== "undefined") {
  armAudioUnlock();
  void fetch(SRC, { method: "HEAD" })
    .then((r) => { fileOk = r.ok && (r.headers.get("content-type") ?? "").startsWith("audio"); })
    .catch(() => { fileOk = false; });
}

function startSynth() {
  if (ambient) { ambient.setMuted(muted); return; }
  ambient = startAmbient(muted);
}

function startFile(): boolean {
  if (typeof window === "undefined") return false;
  if (!audio) {
    audio = new Audio(SRC);
    audio.loop = true;
    audio.preload = "auto";
    audio.addEventListener("error", () => {
      fileOk = false; // undecodable: fall back to the generated soundscape
      audio = null;
      if (wanted) startSynth();
    });
  }
  audio.muted = muted;
  audio.volume = VOLUME;
  void audio.play().catch(() => {
    // Blocked (not inside a gesture, e.g. after a reload): the generated sound is context-based and unlocked below;
    // the file retries on the next tap.
    if (wanted && !ambient) startSynth();
    const retry = () => {
      window.removeEventListener("pointerdown", retry, true);
      if (wanted && audio) void audio.play().then(() => { ambient?.stop(); ambient = null; }).catch(() => {});
    };
    window.addEventListener("pointerdown", retry, { once: true, capture: true });
  });
  return true;
}

/** Start (or resume) the loop. Call it synchronously from the Start / Music tap so the browser allows sound. */
export function startTaskMusic(): void {
  wanted = true;
  unlockAudio(); // resume the context inside the gesture
  if (fileOk) startFile();
  else startSynth();
}

/** Stop and tear down (timer paused, stopped, or the task completed; also on unmount). */
export function stopTaskMusic(): void {
  wanted = false;
  ambient?.stop();
  ambient = null;
  if (!audio) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
    /* nothing playing */
  }
}

export const isMusicMuted = (): boolean => muted;
export const isMusicWanted = (): boolean => wanted;

export function setMusicMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  } catch {
    /* storage blocked */
  }
  unlockAudio(); // this is a tap: make sure the context runs
  if (audio) audio.muted = next;
  ambient?.setMuted(next);
  // Un-muting while a timer runs (e.g. the sound was blocked before): make sure it is really playing now.
  if (!next && wanted) startTaskMusic();
  listeners.forEach((l) => l());
}

export function subscribeMusicMuted(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
