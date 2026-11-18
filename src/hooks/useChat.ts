"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { messageConverter } from "@/lib/firebase/converters";
import { TaskLimitError, type NewTaskInput } from "@/hooks/useTasks";
import { detectPacing, parseSplitRequest } from "@/lib/pacing";
import { estimateFile, focusToPacing } from "@/lib/estimate";
import type { ChatMessage, DateKey, Pacing } from "@/types";
import type { AssistantAction, AssistantRequest, AssistantResponse, ScheduleRequest } from "@/types/api";

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
    async (role: ChatMessage["role"], content: string, kind: ChatMessage["kind"], status: ChatMessage["status"]) => {
      if (!uid) return;
      const ref = doc(collection(db, "users", uid, "messages")).withConverter(messageConverter);
      await setDoc(ref, { id: ref.id, role, content, kind, status, createdAt: new Date().toISOString() });
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
    (text: string, file?: File) =>
      guarded(async () => {
        const message = text.trim() || (file ? (lang === "uk" ? "Оціни це завдання" : "Estimate this assignment") : "");
        if (!message) return;
        await post("user", file ? `📎 ${file.name}\n${message}` : message, "text", "sent");
        // An attached assignment is read once by /api/estimate-task; its estimate rides along with the message.
        const est = file ? await estimateFile(file, lang, message, abortRef.current?.signal) : null;
        const result = await postJson<AssistantResponse>("/api/assistant", {
          message: est
            ? `${message}\n[Attached file "${file!.name}": ${est.reasoning} Estimated ${est.estimatedMinutes} minutes.]`
            : message,
          nowISO: new Date().toISOString(),
        } satisfies AssistantRequest, abortRef.current?.signal);

        if (est && result.intent !== "modify_tasks") {
          // The file becomes the bubble: the assistant's reading of the message (title, deadline) plus the file's estimate.
          const pacing = detectPacing(message) ?? focusToPacing(est.recommendedFocus);
          const requestedParts = parseSplitRequest(message) ?? (est.shouldSplit ? (est.suggestedParts ?? undefined) : undefined);
          const first = result.intent === "create_tasks" ? result.tasks[0] : undefined;
          await addTasks([{
            title: first?.title || est.suggestedTitle,
            deadline: first?.deadline,
            durationMin: est.estimatedMinutes,
            pacing,
            requestedParts,
          }]);
          await post("assistant", `${result.reply}\n✨ ${est.reasoning}`, "text", "sent");
          return;
        }

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
