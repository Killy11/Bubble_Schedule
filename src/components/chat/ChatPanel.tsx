"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, SendHorizontal, Sparkles } from "lucide-react";
import { MicButton } from "@/components/MicButton";
import type { ChatMessage } from "@/types";
import type { ScheduleRequest } from "@/types/api";

const SUGGESTIONS = ["I overslept, shift my morning tasks", "Prioritize study today", "Make my day lighter"];

export function ChatPanel({
  messages,
  pending,
  hasTasks,
  onSend,
  onAsk,
}: {
  messages: ChatMessage[];
  pending: boolean;
  hasTasks: boolean;
  /** Direct scheduling (Auto-schedule button, preset chips). */
  onSend: (trigger: ScheduleRequest["trigger"], text?: string) => void;
  /** Free text: the assistant decides whether to add tasks, re-plan, or just answer. */
  onAsk: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || pending) return;
    onAsk(text);
    setText("");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="pt-6 text-center text-sm text-muted">
            Tell me what you need to do, like “send the report tomorrow 5pm, urgent”, or ask me to re-plan your day.
          </p>
        )}
        {messages.map((m) => {
          const mine = m.role === "user";
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
                  <p className="mt-2 text-xs text-muted">
                    {m.changeSummary.changes.length} change{m.changeSummary.changes.length > 1 ? "s" : ""} applied to your schedule
                  </p>
                )}
              </div>
            </div>
          );
        })}
        {pending && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
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
            <Sparkles className="h-3.5 w-3.5" /> Auto-schedule
          </button>
          {SUGGESTIONS.map((s) => (
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
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            placeholder="Type or speak a task, or ask for changes…"
            className="glass min-w-0 flex-1 rounded-full px-4 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[rgb(var(--glow-a))]"
          />
          <MicButton value={text} onChange={(t) => setText(t.slice(0, 1000))} />
          <button
            type="submit"
            disabled={pending || !text.trim()}
            aria-label="Send"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-90 disabled:opacity-40"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
