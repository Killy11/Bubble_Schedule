"use client";

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, SendHorizontal, Sparkles, Square, X } from "lucide-react";
import { MicButton } from "@/components/MicButton";
import { useLang } from "@/context/LanguageProvider";
import { attachmentProblem, CHAT_ACCEPT, CHAT_MAX_FILES, CHAT_MAX_TOTAL_BYTES, extOf, formatBytes } from "@/lib/attachments";
import type { ChatMessage } from "@/types";
import type { ScheduleRequest } from "@/types/api";

/** Five visible lines of text-sm (20px) plus the vertical padding. */
const MAX_TEXTAREA_PX = 124;

/** A file chip: thumbnail or icon, name, type and size. */
function FileChip({ name, type, size, thumb, onRemove, removeLabel }: {
  name: string; type: string; size?: number; thumb?: string; onRemove?: () => void; removeLabel?: string;
}) {
  const label = (extOf(name) || type.split("/").pop() || "file").toUpperCase();
  return (
    <span className="glass flex max-w-full items-center gap-2 rounded-xl py-1 pl-1 pr-2 text-xs">
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" className="h-8 w-8 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-foreground/10"><FileText className="h-4 w-4" /></span>
      )}
      <span className="min-w-0">
        <span className="block max-w-[11rem] truncate font-medium">{name}</span>
        <span className="block text-[10px] text-muted">{label}{size ? ` · ${formatBytes(size)}` : ""}</span>
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={removeLabel} className="rounded-full p-1 text-muted transition hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

/** The conversation. Memoised, so typing in the composer below never re-renders it. */
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
              className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm ${
                mine ? "bg-foreground text-background"
                : m.status === "error" ? "border border-red-500/40 text-red-500"
                : "glass"}`}
            >
              {m.attachments && m.attachments.length > 0 && (
                <span className="mb-2 flex flex-col items-start gap-1.5 text-foreground">
                  {m.attachments.map((a, i) => <FileChip key={i} name={a.name} type={a.type} size={a.size} thumb={a.thumb} />)}
                </span>
              )}
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
  /** Free text, optionally with files: the assistant adds, changes or re-plans tasks, reads the files, or answers. */
  onAsk: (text: string, files?: File[]) => void;
  /** Cancel the request in flight. */
  onStop: () => void;
}) {
  const { t, lang } = useLang();
  // The draft lives here, in this component only: a keystroke re-renders this composer and nothing above it.
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [listening, setListening] = useState(false); // dictating: keep the newest words in view
  const [sent, setSent] = useState(0); // bumps on submit, which also stops dictation
  const endRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // Object URLs for image previews: made once per file set and released afterwards (not on every keystroke).
  const previews = useMemo(() => files.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);
  const suggestions = [t("I overslept, shift my morning tasks"), t("Make my day lighter")];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, pending]);

  // Grow with the text up to five lines, then scroll inside; back to one line once the text is cleared.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const h = Math.min(el.scrollHeight, MAX_TEXTAREA_PX);
    el.style.height = `${h}px`;
    el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_PX ? "auto" : "hidden";
    // Dictation updates the text programmatically (every interim and final result): follow it to the last line.
    if (listening) el.scrollTop = el.scrollHeight;
  }, [text, listening]);

  function addFiles(list: File[]) {
    if (list.length === 0) return;
    setFileError(null);
    const next = [...files];
    for (const f of list) {
      const problem = attachmentProblem(f);
      if (problem) return setFileError(t(problem));
      if (next.length >= CHAT_MAX_FILES) return setFileError(t("Up to 3 files at a time."));
      next.push(f);
    }
    // Photos are shrunk before sending, so only documents count against the 4 MB request budget here.
    const docBytes = next.filter((f) => !f.type.startsWith("image/")).reduce((n, f) => n + f.size, 0);
    if (docBytes > CHAT_MAX_TOTAL_BYTES) return setFileError(t("The file is larger than 4 MB."));
    setFiles(next);
  }

  function submit() {
    if ((!text.trim() && files.length === 0) || pending) return;
    onAsk(text, files);
    setText("");
    setFiles([]);
    setFileError(null);
    setSent((n) => n + 1);
  }

  return (
    <div
      data-tour="ai-chat"
      className="flex h-full flex-col"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles([...e.dataTransfer.files]); }}
    >
      <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 transition ${dragging ? "ring-2 ring-inset ring-[rgb(var(--glow-a))]" : ""}`}>
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

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <FileChip key={`${f.name}${i}`} name={f.name} type={f.type} size={f.size} removeLabel={t("Remove file")}
                thumb={previews[i]}
                onRemove={() => setFiles((l) => l.filter((_, j) => j !== i))} />
            ))}
          </div>
        )}
        {fileError && <p role="alert" className="text-xs text-red-500">{fileError}</p>}

        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex items-end gap-2">
          <label
            title={t("Attach a file")}
            aria-label={t("Attach a file")}
            className="glass flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition hover:text-foreground"
          >
            <Paperclip className="h-4 w-4" />
            <input type="file" multiple accept={CHAT_ACCEPT} className="sr-only"
              onChange={(e) => { addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
          </label>
          <textarea
            ref={areaRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter adds a line. Never send twice while a reply is generating.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length) { e.preventDefault(); addFiles(pasted); }
            }}
            maxLength={1000}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            placeholder={t("Type or speak a task…")}
            className="glass min-h-10 min-w-0 flex-1 resize-none rounded-2xl px-4 py-2.5 text-sm leading-5 outline-none placeholder:text-muted focus:border-[rgb(var(--glow-a))]"
            style={{ overflowY: "hidden" }}
          />
          <MicButton value={text} onChange={(v) => setText(v.slice(0, 1000))} stopKey={sent} onListeningChange={setListening} fixedLang={lang === "uk" ? "uk-UA" : "en-US"} />
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
              disabled={!text.trim() && files.length === 0}
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
