import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionUid } from "@/lib/firebase/serverAuth";

export const maxDuration = 15;
const CATEGORIES = new Set(["bug", "feature", "general"]);
const err = (error: string, status: number) => NextResponse.json({ error }, { status });

/** POST /api/feedback: validates and stores feedback with the Admin SDK (bypasses Firestore rules). */
export async function POST(request: Request) {
  const uid = await getSessionUid();
  if (!uid) return err("Not signed in", 401);

  let body: { category?: unknown; message?: unknown; email?: unknown };
  try {
    body = await request.json();
  } catch {
    return err("Invalid request body", 400);
  }
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
  const category = typeof body.category === "string" && CATEGORIES.has(body.category) ? body.category : "general";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";
  if (!message) return err("Message is required", 400);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("Invalid email", 400);

  try {
    await adminDb().collection("feedback").add({ category, message, email, userId: uid, createdAt: new Date() });
  } catch (e) {
    console.error("feedback: save failed", e);
    return err("Couldn't save feedback", 500);
  }
  return NextResponse.json({ ok: true });
}
