import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getSessionUid } from "@/lib/firebase/serverAuth";
import { sendPush } from "@/lib/server/push";
import { takeHourlySlot } from "@/lib/server/rateLimit";

/** POST /api/notifications/test: sends a real push to the signed-in user's registered devices (the whole pipeline). */
export const maxDuration = 30;
const err = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: Request) {
  const uid = await getSessionUid();
  if (!uid) return err("Not signed in", 401);
  if (!(await takeHourlySlot(uid, "pushtest", 20))) return err("Too many tests. Try again later.", 429);

  let lang: "en" | "uk" = "en";
  try {
    lang = ((await request.json()) as { lang?: string }).lang === "uk" ? "uk" : "en";
  } catch {
    /* body is optional */
  }
  const user = (await adminDb().doc(`users/${uid}`).get()).data();
  const tokens: string[] = Array.isArray(user?.fcmTokens) ? user.fcmTokens : [];
  if (tokens.length === 0) return err("No device is registered for notifications yet.", 409);

  try {
    const ok = await sendPush(uid, tokens, {
      title: lang === "uk" ? "🔔 Тестове сповіщення" : "🔔 Test notification",
      body: lang === "uk" ? "Усе працює: сповіщення надходять на цей пристрій." : "It works: notifications reach this device.",
      url: "/dashboard",
      blockId: `test_${Date.now()}`,
    });
    if (!ok) return err("No device accepted the push (its token may have expired). Turn notifications off and on again.", 502);
  } catch (e) {
    console.error("notification test failed", e);
    return err("The push service rejected the message.", 502);
  }
  return NextResponse.json({ ok: true, devices: tokens.length });
}
