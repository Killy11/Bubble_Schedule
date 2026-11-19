"use client";

import { useEffect, useImperativeHandle, type Ref } from "react";
import { Mic, Square } from "lucide-react";
import { useLang } from "@/context/LanguageProvider";
import { useToast } from "@/context/ToastProvider";
import { useSpeechInput, useSpeechLang, type SpeechLang } from "@/hooks/useSpeechInput";

/** Mic + language switch (UA / EN). Dictates into the text value owned by the parent. */
export function MicButton({
  value,
  onChange,
  size = "md",
  fixedLang,
  stopKey,
  onListeningChange,
  controlRef,
}: {
  value: string;
  onChange: (text: string) => void;
  size?: "sm" | "md";
  /** Use this language and hide the UA / EN switch (e.g. follow the UI language). */
  fixedLang?: SpeechLang;
  /** Change this value (e.g. when the message is submitted) to stop listening right away. */
  stopKey?: unknown;
  /** Called when dictation starts or ends. */
  onListeningChange?: (listening: boolean) => void;
  /** `abort()` ends dictation synchronously and discards late microphone results: call it first thing on submit. */
  controlRef?: Ref<{ abort: () => void }>;
}) {
  const { toast } = useToast();
  const { t } = useLang();
  const [savedLang, setLang] = useSpeechLang();
  const lang = fixedLang ?? savedLang;
  const { supported, listening, start, stop, abort } = useSpeechInput({
    lang,
    onTranscript: onChange,
    onError: (message) => toast({ title: t("Voice input"), body: t(message) }),
  });
  useImperativeHandle(controlRef, () => ({ abort }), [abort]);
  useEffect(() => {
    onListeningChange?.(listening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening]);
  useEffect(() => {
    abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopKey]);
  const dim = size === "sm" ? "h-9 w-9" : "h-10 w-10";

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {!fixedLang && <button
        type="button"
        onClick={() => setLang(lang === "uk-UA" ? "en-US" : "uk-UA")}
        disabled={listening}
        aria-label={`${t("Voice language")}: ${lang === "uk-UA" ? "UA" : "EN"}`}
        title={t("Voice language")}
        className="glass h-7 rounded-full px-2 text-[10px] font-semibold tracking-wide text-muted transition hover:text-foreground disabled:opacity-50"
      >
        {lang === "uk-UA" ? "UA" : "EN"}
      </button>}
      <button
        type="button"
        onClick={() => (listening ? stop() : start(value))}
        aria-label={listening ? t("Stop") : t("Speak")}
        aria-pressed={listening}
        title={supported ? (listening ? t("Stop") : t("Speak")) : t("Voice input isn't supported in this browser. Try Chrome, Edge or Safari.")}
        className={`relative flex ${dim} items-center justify-center rounded-full transition ${
          listening ? "bg-red-500 text-white" : "glass text-muted hover:text-foreground"
        } ${supported ? "" : "opacity-50"}`}
      >
        {listening && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-red-500/50" />}
        {listening ? <Square className="relative h-3.5 w-3.5 fill-current" /> : <Mic className="relative h-4 w-4" />}
      </button>
      <span className="sr-only" aria-live="polite">{listening ? t("Listening") : ""}</span>
    </div>
  );
}
