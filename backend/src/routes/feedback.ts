import { NextResponse } from "next/server";
import { adminDb } from "@backend/firebase/admin";
import { getSessionUid } from "@backend/firebase/serverAuth";

const MAX_PER_HOUR = 5;
const MAX_IMAGES = 3;
const CATEGORIES = new Set(["bug", "feature", "general"]);
const err = (error: string, status: number) => NextResponse.json({ error }, { status });

/** POST /api/feedback: validates and stores feedback with the Admin SDK (bypasses Firestore rules). */
export async function POST(request: Request) {
  const uid = await getSessionUid();
  if (!uid) return err("Not signed in", 401);

  let body: { category?: unknown; message?: unknown; images?: unknown };
  try {
    body = await request.json();
  } catch {
    return err("Invalid request body", 400);
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  const category = typeof body.category === "string" && CATEGORIES.has(body.category) ? body.category : "general";
  if (!message) return err("Message is required", 400);
  // Up to 3 client-compressed JPEG data URLs. Each is stored as its own small document (a Firestore document is limited to 1 MiB).
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((x): x is string => typeof x === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(x) && x.length <= 700_000)
    .slice(0, MAX_IMAGES);

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

    const ref = db.collection("feedback").doc();
    const batch = db.batch();
    batch.set(ref, { category, message, userId: uid, attachmentCount: images.length, createdAt: new Date() });
    images.forEach((dataUrl, i) => batch.set(ref.collection("attachments").doc(String(i)), { dataUrl, index: i }));
    await batch.commit();
  } catch (e) {
    console.error("feedback: save failed", e);
    return err("Couldn't save feedback", 500);
  }
  return NextResponse.json({ ok: true });
}
