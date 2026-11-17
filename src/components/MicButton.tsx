"use client";

import { Mic, Square } from "lucide-react";
import { useToast } from "@/context/ToastProvider";
import { useSpeechInput, useSpeechLang } from "@/hooks/useSpeechInput";

/** Mic + language switch (UK / EN). Dictates into the text value owned by the parent. */
export function MicButton({
  value,
  onChange,
  size = "md",
}: {
  value: string;
  onChange: (text: string) => void;
  size?: "sm" | "md";
}) {
  const { toast } = useToast();
  const [lang, setLang] = useSpeechLang();
  const { supported, listening, start, stop } = useSpeechInput({
    lang,
    onTranscript: onChange,
    onError: (message) => toast({ title: "Voice input", body: message }),
  });
  const dim = size === "sm" ? "h-9 w-9" : "h-10 w-10";

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => setLang(lang === "uk-UA" ? "en-US" : "uk-UA")}
        disabled={listening}
        aria-label={`Voice language: ${lang === "uk-UA" ? "Ukrainian" : "English"}. Tap to switch.`}
        title="Voice language"
        className="glass h-7 rounded-full px-2 text-[10px] font-semibold tracking-wide text-muted transition hover:text-foreground disabled:opacity-50"
      >
        {lang === "uk-UA" ? "UK" : "EN"}
      </button>
      <button
        type="button"
        onClick={() => (listening ? stop() : start(value))}
        aria-label={listening ? "Stop recording" : "Speak your task"}
        aria-pressed={listening}
        title={supported ? (listening ? "Stop" : "Speak") : "Voice input isn't supported in this browser"}
        className={`relative flex ${dim} items-center justify-center rounded-full transition ${
          listening ? "bg-red-500 text-white" : "glass text-muted hover:text-foreground"
        } ${supported ? "" : "opacity-50"}`}
      >
        {listening && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-red-500/50" />}
        {listening ? <Square className="relative h-3.5 w-3.5 fill-current" /> : <Mic className="relative h-4 w-4" />}
      </button>
      <span className="sr-only" aria-live="polite">{listening ? "Listening" : ""}</span>
    </div>
  );
}
