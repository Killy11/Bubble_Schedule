"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, SendHorizontal, Sparkles, Square, X } from "lucide-react";
import { ESTIMATE_ACCEPT } from "@/lib/estimate";
import { MicButton } from "@/components/MicButton";
import { useLang } from "@/context/LanguageProvider";
import type { ChatMessage } from "@/types";
import type { ScheduleRequest } from "@/types/api";

/** The conversation. Memoised, so typing in the input below never re-renders it. */
const MessageList = memo(function MessageList({ messages }: { messages: ChatMessage[] }) {
  const { t } = useLang();
  return (
    <>
      {messages.map((m) => {
        const mine = m.role === "user";
        if (m.kind === "note") {
          return <p key={m.id} className="text-center text-xs italic text-muted">{m.content}</p>; // e.g. "Response stopped"
        }
        return (
          <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm ${
                mine ? "bg-foreground text-background"
                : m.status === "error" ? "border border-red-500/40 text-red-500"
                : "glass"}`}
            >
              {m.content}
              {m.changeSummary && m.changeSummary.changes.length > 0 && (
                <p className="mt-2 text-xs text-muted">{t("{n} changes applied", { n: m.changeSummary.changes.length })}</p>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
});

export function ChatPanel({
  messages,
  pending,
  hasTasks,
  onSend,
  onAsk,
  onStop,
}: {
  messages: ChatMessage[];
  pending: boolean;
  hasTasks: boolean;
  /** Direct scheduling (Auto-schedule button, preset chips). */
  onSend: (trigger: ScheduleRequest["trigger"], text?: string) => void;
  /** Free text: the assistant decides whether to add, change or re-plan tasks, or just answer. */
  onAsk: (text: string, file?: File) => void;
  /** Cancel the request in flight. */
  onStop: () => void;
}) {
  const { t } = useLang();
  // The draft lives here, in this component only: a keystroke re-renders this input and nothing above it.
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const suggestions = [t("I overslept, shift my morning tasks"), t("Make my day lighter")];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if ((!text.trim() && !file) || pending) return;
    onAsk(text, file ?? undefined);
    setText("");
    setFile(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && <p className="pt-6 text-center text-sm text-muted">{t("Add or change tasks in plain words")}</p>}
        <MessageList messages={messages} />
        {pending && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("Thinking…")}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="space-y-3 border-t border-line p-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onSend("auto-schedule")}
            disabled={pending || !hasTasks}
            className="flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition hover:opacity-90 disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> {t("Auto-schedule")}
          </button>
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => onSend("user-message", s)}
              disabled={pending || !hasTasks}
              className="glass rounded-full px-3 py-1.5 text-xs text-muted transition hover:text-foreground disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        {file && (
          <div className="glass flex items-center gap-2 rounded-full py-1 pl-3 pr-1 text-xs">
            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <button type="button" onClick={() => setFile(null)} aria-label={t("Remove file")}
              className="rounded-full p-1 text-muted transition hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        <form onSubmit={submit} className="flex gap-2">
          <label
            title={t("Attach a file")}
            aria-label={t("Attach a file")}
            className="glass flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition hover:text-foreground"
          >
            <Paperclip className="h-4 w-4" />
            <input type="file" accept={ESTIMATE_ACCEPT} className="sr-only"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
          </label>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            placeholder={t("Type or speak a task…")}
            className="glass min-w-0 flex-1 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[rgb(var(--glow-a))]"
          />
          <MicButton value={text} onChange={(v) => setText(v.slice(0, 1000))} />
          {pending ? (
            <button
              type="button"
              onClick={onStop}
              title={t("Stop")}
              aria-label={t("Stop")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10 text-zinc-100 transition-all hover:border-rose-400/40 hover:bg-rose-500/20"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!text.trim() && !file}
              aria-label={t("Send")}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:opacity-40"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
