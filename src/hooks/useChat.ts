"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { messageConverter } from "@/lib/firebase/converters";
import { TaskLimitError, type NewTaskInput } from "@/hooks/useTasks";
import { detectPacing, parseSplitRequest } from "@/lib/pacing";
import { extOf, prepareAttachment, thumbnailOf } from "@/lib/attachments";
import type { ChatMessage, DateKey, Pacing } from "@/types";
import type { AssistantAction, AssistantRequest, AssistantResponse, ScheduleRequest } from "@/types/api";

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const isForm = body instanceof FormData; // multipart: the browser sets the boundary header itself
  const res = await fetch(url, {
    signal,
    method: "POST",
    headers: isForm ? undefined : { "Content-Type": "application/json" },
    body: isForm ? body : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(err?.error ?? "Request failed");
  }
  return (await res.json()) as T;
}

import { useLang } from "@/context/LanguageProvider";

export function useChat(
  uid: string | undefined,
  targetDate: DateKey,
  /** Creates all tasks in one batched write. */
  addTasks: (inputs: NewTaskInput[]) => Promise<void>,
  /** Pacing for tasks created from chat when the message doesn't say otherwise. */
  defaultPacing: Pacing,
  /** Apply AI edits (reschedule, change duration, complete, delete) to the shared task state. */
  applyActions: (actions: AssistantAction[]) => Promise<void>,
) {
  const { lang, t } = useLang();
  // The request in flight, so Stop can cancel it.
  const abortRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!uid) return;
    // newest 100, displayed oldest → newest
    const q = query(
      collection(db, "users", uid, "messages").withConverter(messageConverter),
      orderBy("createdAt", "desc"),
      limit(100),
    );
    return onSnapshot(
      q,
      (snap) => setMessages(snap.docs.map((d) => d.data()).reverse()),
      (e) => {
        // warn, not error: console.error would raise the Next.js dev overlay
        console.warn("messages listener:", e.code);
        setMessages([]);
      },
    );
  }, [uid]);

  const post = useCallback(
    async (role: ChatMessage["role"], content: string, kind: ChatMessage["kind"], status: ChatMessage["status"], attachments?: ChatMessage["attachments"]) => {
      if (!uid) return;
      const ref = doc(collection(db, "users", uid, "messages")).withConverter(messageConverter);
      await setDoc(ref, { id: ref.id, role, content, kind, status, ...(attachments?.length ? { attachments } : {}), createdAt: new Date().toISOString() });
    },
    [uid],
  );

  /** Ask /api/schedule to (re)build the day. The server writes the assistant reply to Firestore. */
  const runSchedule = useCallback(
    async (trigger: ScheduleRequest["trigger"], message?: string) => {
      const body: ScheduleRequest = { trigger, message, targetDate, nowISO: new Date().toISOString(), lang };
      await postJson("/api/schedule", body, abortRef.current?.signal);
    },
    [targetDate, lang],
  );

  /**
   * Wrap an action: pending flag, an AbortController for Stop, and a visible error message in the chat if
   * anything throws. A cancelled request is not an error: it leaves a quiet "Response stopped" note.
   */
  const guarded = useCallback(
    async (action: () => Promise<void>) => {
      if (!uid || pending) return; // no duplicate requests while one is running
      const controller = new AbortController();
      abortRef.current = controller;
      setPending(true);
      try {
        await action();
      } catch (e) {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          await post("system", lang === "uk" ? "Відповідь зупинено" : "Response stopped", "note", "sent").catch(() => {});
        } else {
          const msg = e instanceof TaskLimitError ? t(e.message) : `${t("Something went wrong. Please try again.")} (${e instanceof Error ? t(e.message) : ""})`;
          await post("system", msg, "text", "error").catch(() => {});
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setPending(false);
        }
      }
    },
    [uid, pending, post, lang, t],
  );

  /** Stop generating: cancel the request and free the composer immediately. */
  const stop = useCallback(() => {
    abortRef.current?.abort(); // kept in the ref: any later step of the cancelled action sees an aborted signal
    setPending(false);
  }, []);

  /** Direct scheduling: the Auto-schedule button and the preset suggestion chips (no intent step). */
  const send = useCallback(
    (trigger: ScheduleRequest["trigger"], text?: string) =>
      guarded(async () => {
        const message = text?.trim();
        await post(
          "user",
          message || "Auto-schedule my day",
          trigger === "auto-schedule" ? "auto-schedule-request" : "text",
          "sent",
        );
        await runSchedule(trigger, message);
      }),
    [guarded, post, runSchedule],
  );

  /**
   * Free-text chat. /api/assistant works out the intent:
   *  create_tasks → the extracted tasks become bubbles
   *  schedule     → handed on to /api/schedule with the user's wording
   *  answer       → just show the reply
   */
  const ask = useCallback(
    (text: string, files: File[] = []) =>
      guarded(async () => {
        const message = text.trim() || (files.length ? (lang === "uk" ? "Проаналізуй і підсумуй цей файл." : "Analyze and summarize this file.") : "");
        if (!message) return;
        const meta = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type || extOf(f.name), size: f.size, thumb: await thumbnailOf(f) })));
        await post("user", message, "text", "sent", meta);
        // With files, the request is multipart: Gemini receives the PDFs / images inline and the other documents as text.
        let payload: FormData | AssistantRequest;
        if (files.length) {
          const form = new FormData();
          form.set("message", message);
          form.set("nowISO", new Date().toISOString());
          for (const f of await Promise.all(files.map(prepareAttachment))) form.append("files", f, f.name);
          payload = form;
        } else {
          payload = { message, nowISO: new Date().toISOString() } satisfies AssistantRequest;
        }
        const result = await postJson<AssistantResponse>("/api/assistant", payload, abortRef.current?.signal);

        if (result.intent === "schedule") {
          await runSchedule("user-message", message); // writes its own assistant reply
          return;
        }
        if (result.intent === "modify_tasks") {
          // Same code path as the UI's own edits: one Firestore write, and the canvas and the timeline both follow.
          await applyActions(result.actions);
          await post("assistant", result.reply, "text", "sent");
          return;
        }
        // "chill", "все підряд", "розбий на 3 частини"… in the message set how the new tasks are laid out.
        const pacing = detectPacing(message) ?? defaultPacing;
        const requestedParts = parseSplitRequest(message) ?? undefined;
        // One batched write for the whole request (up to 25 tasks), so the canvas updates once.
        await addTasks(result.tasks.map((x) => ({ title: x.title, deadline: x.deadline, durationMin: x.durationMin, pacing, requestedParts })));
        await post("assistant", result.reply, "text", "sent"); // new tasks are folded into the plan by the auto re-plan
      }),
    [guarded, post, runSchedule, addTasks, defaultPacing, applyActions, lang],
  );

  return { messages, pending, send, ask, stop };
}
