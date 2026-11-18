import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionUid } from "@/lib/firebase/serverAuth";

export const maxDuration = 15;
const MAX_PER_HOUR = 5;
const CATEGORIES = new Set(["bug", "feature", "general"]);
const err = (error: string, status: number) => NextResponse.json({ error }, { status });

/** POST /api/feedback: validates and stores feedback with the Admin SDK (bypasses Firestore rules). */
export async function POST(request: Request) {
  const uid = await getSessionUid();
  if (!uid) return err("Not signed in", 401);

  let body: { category?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return err("Invalid request body", 400);
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  const category = typeof body.category === "string" && CATEGORIES.has(body.category) ? body.category : "general";
  if (!message) return err("Message is required", 400);

  try {
    // Rate limit: single-field query (no composite index needed); the time window is checked in memory.
    const db = adminDb();
    const mine = await db.collection("feedback").where("userId", "==", uid).get();
    const since = Date.now() - 3_600_000;
    const recent = mine.docs.filter((d) => {
      const at = d.get("createdAt") as { toMillis?: () => number } | undefined;
      return (at?.toMillis?.() ?? 0) > since;
    }).length;
    if (recent >= MAX_PER_HOUR) return err("Too many feedback messages. Try again later.", 429);

    await db.collection("feedback").add({ category, message, userId: uid, createdAt: new Date() });
  } catch (e) {
    console.error("feedback: save failed", e);
    return err("Couldn't save feedback", 500);
  }
  return NextResponse.json({ ok: true });
}
