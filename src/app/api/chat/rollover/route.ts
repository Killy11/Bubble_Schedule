import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { fromFirestoreData } from "@/lib/firebase/converters";
import { getSessionUid } from "@/lib/firebase/serverAuth";
import { describeAiError, generateJson, hasGeminiKey } from "@/lib/ai/gemini";
import { MAX_MEMORY, mergeMemory, sameMemory } from "@/lib/memory";
import { dateKeyInTz } from "@/lib/time";
import type { ChatMessage, User } from "@/types";

/**
 * POST /api/chat/rollover: the daily chat reset. If the chat belongs to an earlier day, the permanent habits and
 * preferences in it are folded into the user's compact memory (max 12 short items) and the old messages are deleted, so
 * every day starts with a fast, empty chat. Calling it again on the same day does nothing.
 */
export const maxDuration = 60;

const SYSTEM = `You maintain a short long-term memory about a user of a planner app.
You get the current memory list and yesterday's chat. Return the UPDATED memory: only permanent habits, routines and preferences of the user (for example "Тренування щодня о 22:00", "Study best in the morning", "Prefers short breaks"). Never store one-off tasks, dates, questions or small talk.
Keep every item short (under 100 characters), in the language the user wrote it in, with no duplicates and no near-duplicates (merge them). Keep existing items unless the chat contradicts them. At most ${MAX_MEMORY} items; if there are more, keep the most useful and recent ones.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["memory"],
  properties: { memory: { type: "array", items: { type: "string" } } },
} as const;

const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST() {
  const uid = await getSessionUid();
  if (!uid) return err("Not signed in", 401);

  const db = adminDb();
  const userSnap = await db.doc(`users/${uid}`).get();
  const user = userSnap.exists ? fromFirestoreData<User>(userSnap.data()) : null;
  const tz = user?.timezone ?? "UTC";
  const now = new Date();
  const today = dateKeyInTz(now, tz);

  const msgSnap = await db.collection(`users/${uid}/messages`).orderBy("createdAt", "desc").limit(200).get();
  if (msgSnap.empty) {
    if (user?.chatDate !== today) await db.doc(`users/${uid}`).update({ chatDate: today });
    return NextResponse.json({ cleared: 0 });
  }
  const messages = msgSnap.docs.map((d) => fromFirestoreData<ChatMessage>(d.data())).reverse();
  const lastDay = dateKeyInTz(messages[messages.length - 1].createdAt, tz);
  if (lastDay >= today) return NextResponse.json({ cleared: 0 }); // the chat is from today

  const existing = Array.isArray(user?.userMemory) ? user.userMemory : [];
  let memory = existing;
  if (hasGeminiKey()) {
    const transcript = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.kind !== "note")
      .slice(-60)
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 600)}`)
      .join("\n");
    try {
      const out = await generateJson<{ memory: string[] }>({
        system: SYSTEM,
        turns: [{ role: "user", text: JSON.stringify({ currentMemory: existing, chat: transcript }) }],
        schema: SCHEMA,
        temperature: 0.1,
        effort: "none",
      });
      memory = mergeMemory([], Array.isArray(out.memory) ? out.memory : existing); // cleaned, de-duplicated, capped
    } catch (e) {
      // Keep the chat for now: it is cleared on a later visit, once the summary can be written.
      console.error("chat rollover: summary failed", e);
      const { message, status } = describeAiError(e);
      return err(message, status);
    }
  }

  // Delete every old message (in batches), then write the memory and today's chat date.
  for (let i = 0; i < 20; i++) {
    const page = await db.collection(`users/${uid}/messages`).limit(400).get();
    if (page.empty) break;
    const batch = db.batch();
    page.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await db.doc(`users/${uid}`).update({ chatDate: today, ...(sameMemory(existing, memory) ? {} : { userMemory: memory }) });
  return NextResponse.json({ cleared: messages.length, memory: memory.length });
}
