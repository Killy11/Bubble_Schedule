"use client";

import { useCallback, useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { messageConverter } from "@/lib/firebase/converters";
import type { NewTaskInput } from "@/hooks/useTasks";
import { detectPacing, parseSplitRequest } from "@/lib/pacing";
import type { ChatMessage, DateKey, Pacing } from "@/types";
import type { AssistantAction, AssistantRequest, AssistantResponse, ScheduleRequest } from "@/types/api";

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
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

export function useChat(
  uid: string | undefined,
  targetDate: DateKey,
  addTask: (input: NewTaskInput) => Promise<void>,
  /** Pacing for tasks created from chat when the message doesn't say otherwise. */
  defaultPacing: Pacing,
  /** Apply AI edits (reschedule, change duration, complete, delete) to the shared task state. */
  applyActions: (actions: AssistantAction[]) => Promise<void>,
) {
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
      const body: ScheduleRequest = { trigger, message, targetDate, nowISO: new Date().toISOString() };
      await postJson("/api/schedule", body);
    },
    [targetDate],
  );

  /** Wrap an action: pending flag + a visible error message in the chat if anything throws. */
  const guarded = useCallback(
    async (action: () => Promise<void>) => {
      if (!uid || pending) return;
      setPending(true);
      try {
        await action();
      } catch (e) {
        await post("system", `Something went wrong: ${e instanceof Error ? e.message : "unknown error"}`, "text", "error").catch(() => {});
      } finally {
        setPending(false);
      }
    },
    [uid, pending, post],
  );

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
    (text: string) =>
      guarded(async () => {
        const message = text.trim();
        if (!message) return;
        await post("user", message, "text", "sent");
        const result = await postJson<AssistantResponse>("/api/assistant", {
          message,
          nowISO: new Date().toISOString(),
        } satisfies AssistantRequest);

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
        for (const t of result.tasks) {
          await addTask({ title: t.title, deadline: t.deadline, durationMin: t.durationMin, pacing, requestedParts });
        }
        await post("assistant", result.reply, "text", "sent"); // new tasks are folded into the plan by the auto re-plan
      }),
    [guarded, post, runSchedule, addTask, defaultPacing, applyActions],
  );

  return { messages, pending, send, ask };
}
