import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionUid } from "@/lib/firebase/serverAuth";
import { describeAiError, generateJson, hasGeminiKey } from "@/lib/ai/gemini";
import { fromFirestoreData } from "@/lib/firebase/converters";
import {
  ASSISTANT_JSON_SCHEMA,
  ASSISTANT_SYSTEM_PROMPT,
  localNow,
  mockAssistant,
  normalizeActions,
  normalizeTasks,
  type RawAssistantResult,
} from "@/lib/ai/assistant";
import { weekdayOf, dateKeyInTz, toLocalNaive } from "@/lib/time";
import type { ChatMessage, Task, User } from "@/types";
import type { AssistantRequest, AssistantResponse } from "@/types/api";

export const maxDuration = 30;
const MAX_MESSAGE = 1000;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  const uid = await getSessionUid();
  if (!uid) return err("Not signed in", 401);

  let body: AssistantRequest;
  try {
    body = (await request.json()) as AssistantRequest;
  } catch {
    return err("Invalid request body", 400);
  }
  const message = body.message?.trim().slice(0, MAX_MESSAGE);
  if (!message) return err("Say something first.", 400);
  if (Number.isNaN(Date.parse(body.nowISO))) return err("nowISO is invalid", 400);
  const now = new Date(body.nowISO);
  if (Math.abs(now.getTime() - Date.now()) > 10 * 60_000) return err("Your device clock looks wrong", 400);

  const db = adminDb();
  const [userSnap, taskSnap, msgSnap] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.collection(`users/${uid}/tasks`).where("status", "==", "active").limit(60).get(),
    db.collection(`users/${uid}/messages`).orderBy("createdAt", "desc").limit(7).get(),
  ]);
  const tz = userSnap.exists ? (fromFirestoreData<User>(userSnap.data()).timezone ?? "UTC") : "UTC";

  const existing = taskSnap.docs
    .map((d) => ({ ...fromFirestoreData<Task>(d.data()), id: d.id }))
    .sort((a, b) => (a.deadline ?? "9").localeCompare(b.deadline ?? "9"));

  let raw: RawAssistantResult;
  let mock = false;

  if (!hasGeminiKey()) {
    // No key yet: keep the full flow usable with a heuristic stand-in.
    raw = mockAssistant(message, now, tz);
    mock = true;
  } else {
    const history = msgSnap.docs
      .map((d) => fromFirestoreData<ChatMessage>(d.data()))
      .reverse()
      .slice(0, -1) // the newest is the message being sent now
      .slice(-6)
      .map((m) => ({ role: m.role, content: m.content }));
    const today = dateKeyInTz(now, tz);
    const context = {
      NOW: localNow(now, tz),
      today: `${DAYS[weekdayOf(today)]} ${today}`,
      timezone: tz,
      existingTasks: existing.map((t) => ({
        id: t.id,
        title: t.title,
        deadline: t.deadline ? toLocalNaive(t.deadline, tz) : null,
        durationMin: t.durationMin ?? null,
      })),
      recentChat: history,
      userMessage: message,
    };
    try {
      raw = await generateJson<RawAssistantResult>({
        system: ASSISTANT_SYSTEM_PROMPT,
        turns: [{ role: "user", text: JSON.stringify(context) }],
        schema: ASSISTANT_JSON_SCHEMA,
        temperature: 0.2,
        effort: "none", // plain extraction: no reasoning needed, so it answers fast
      });
    } catch (e) {
      console.error("assistant: model call failed", e);
      const { message, status } = describeAiError(e);
      return err(message, status);
    }
  }

  const tasks = raw.intent === "create_tasks" ? normalizeTasks(raw.tasks ?? [], tz) : [];
  const actions =
    raw.intent === "modify_tasks" ? normalizeActions(raw.actions ?? [], new Set(existing.map((t) => t.id)), tz) : [];
  const response: AssistantResponse = {
    // create_tasks with nothing usable degrades to a plain answer
    intent:
      (raw.intent === "create_tasks" && tasks.length === 0) || (raw.intent === "modify_tasks" && actions.length === 0)
        ? "answer"
        : raw.intent,
    reply: String(raw.reply ?? "").slice(0, 1200) || "Done.",
    tasks,
    actions,
    ...(mock ? { mock: true } : {}),
  };
  return NextResponse.json(response);
}
