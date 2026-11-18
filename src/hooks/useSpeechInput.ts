"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

export type SpeechLang = "uk-UA" | "en-US";

// The Web Speech API isn't in TypeScript's DOM lib, so declare the small part we use.
interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEventLike {
  results: ArrayLike<SpeechResultLike>;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

// ── Remembered language (shared by every mic button) ─────────────────────────────────
const LANG_KEY = "bs:speechLang";
const langListeners = new Set<() => void>();
function readLang(): SpeechLang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "uk-UA" || saved === "en-US") return saved;
  } catch {}
  return navigator.language?.toLowerCase().startsWith("uk") ? "uk-UA" : "en-US";
}

export function useSpeechLang() {
  const lang = useSyncExternalStore(
    (cb) => {
      langListeners.add(cb);
      return () => langListeners.delete(cb);
    },
    readLang,
    () => "en-US" as SpeechLang,
  );
  const setLang = useCallback((next: SpeechLang) => {
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {}
    langListeners.forEach((f) => f());
  }, []);
  return [lang, setLang] as const;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Allow it in your browser's site settings and try again.",
  "service-not-allowed": "Microphone access is blocked. Allow it in your browser's site settings and try again.",
  "no-speech": "I didn't hear anything. Tap the mic and try again.",
  "audio-capture": "No microphone was found.",
  network: "Voice input needs an internet connection.",
  "language-not-supported": "That language isn't supported for voice input in this browser.",
};

/** Dictation ends after this long without any speech. */
export const SILENCE_MS = 5000;

/** One-tap dictation. `start(base)` keeps `base` and appends what is said, live, via `onTranscript`. */
export function useSpeechInput(opts: {
  lang: SpeechLang;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}) {
  const supported = useSyncExternalStore(noopSubscribe, () => getCtor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<RecognitionLike | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearSilence = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
  };
  const cb = useRef(opts);
  useEffect(() => {
    cb.current = opts;
  });
  useEffect(
    () => () => {
      clearSilence(); // no stale timer after unmount
      recRef.current?.abort();
    },
    [],
  );

  const start = useCallback(
    (base: string) => {
      const Ctor = getCtor();
      if (!Ctor) return cb.current.onError("Voice input isn't supported in this browser. Try Chrome, Edge or Safari.");
      const rec = new Ctor();
      rec.lang = opts.lang;
      rec.interimResults = true;
      rec.continuous = true; // short pauses between words and sentences don't end the recording
      // Stop by ourselves only after 5 full seconds with no speech; any result (interim or final) restarts the count.
      const armSilence = () => {
        clearSilence();
        silenceTimerRef.current = setTimeout(() => recRef.current?.stop(), SILENCE_MS);
      };
      const prefix = base && !/\s$/.test(base) ? `${base} ` : base;
      rec.onresult = (e) => {
        armSilence();
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        cb.current.onTranscript(prefix + text.trim());
      };
      rec.onerror = (e) => {
        if (e.error === "aborted") return;
        cb.current.onError(ERRORS[e.error] ?? "Voice input stopped unexpectedly. Please try again.");
      };
      rec.onend = () => {
        clearSilence();
        setListening(false);
        recRef.current = null;
      };
      try {
        rec.start();
        recRef.current = rec;
        setListening(true);
        armSilence(); // also counts from the moment listening begins
      } catch {
        cb.current.onError("Couldn't start the microphone. Please try again.");
      }
    },
    [opts.lang],
  );

  const stop = useCallback(() => {
    clearSilence();
    recRef.current?.stop();
  }, []);
  return { supported, listening, start, stop };
}
