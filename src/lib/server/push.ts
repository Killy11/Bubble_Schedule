import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb, adminMessaging } from "@/lib/firebase/admin";

export type Lang = "en" | "uk";

const DEAD_TOKEN_CODES = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token"]);
const ACTION_TTL_MS = 3 * 3_600_000;

/** What a notification button may do. `ref` is a block id or a part id, depending on `kind`. */
export interface ActionPayload {
  uid: string;
  taskId: string;
  kind: "task" | "block" | "part";
  ref?: string;
  exp: number;
}

const secret = () => process.env.NOTIFICATION_ACTION_SECRET || process.env.CRON_SECRET || "";

/** Signed, expiring token carried inside the push, so the buttons work without a session cookie. */
export function signAction(p: Omit<ActionPayload, "exp">): string {
  const body = Buffer.from(JSON.stringify({ ...p, exp: Date.now() + ACTION_TTL_MS })).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAction(token: string): ActionPayload | null {
  if (!secret()) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", secret()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as ActionPayload;
    return p.exp > Date.now() && p.uid && p.taskId ? p : null;
  } catch {
    return null;
  }
}

/** Notification copy in the user's language. */
export const COPY = {
  start: (lang: Lang, title: string) => (lang === "uk" ? `⏰ Через 5 хв починається: ${title}` : `⏰ Starting in 5 min: ${title}`),
  startBody: (lang: Lang) => (lang === "uk" ? "Час братися до роботи." : "Time to get going."),
  due: (lang: Lang, title: string) => (lang === "uk" ? `⏳ Залишився 1 день до дедлайну: ${title}` : `⏳ 1 day left until deadline: ${title}`),
  dueBody: (lang: Lang, hours: number) => (lang === "uk" ? `До дедлайну приблизно ${hours} год.` : `Due in about ${hours} h.`),
  done: (lang: Lang) => (lang === "uk" ? "Готово ✓" : "Mark Done ✓"),
  snooze: (lang: Lang) => (lang === "uk" ? "Відкласти на 15 хв" : "Snooze 15m"),
};

/**
 * Send a data-only push to every token of a user (the service worker builds the notification, with its buttons).
 * Dead tokens are removed. Returns whether at least one device accepted it.
 */
export async function sendPush(
  uid: string,
  tokens: string[],
  data: Record<string, string>,
): Promise<boolean> {
  const res = await adminMessaging().sendEachForMulticast({
    tokens,
    data,
    webpush: { headers: { Urgency: "high", TTL: "600" } },
  });
  const dead = tokens.filter((_, i) => {
    const code = res.responses[i].error?.code;
    return code !== undefined && DEAD_TOKEN_CODES.has(code);
  });
  if (dead.length) await adminDb().doc(`users/${uid}`).update({ fcmTokens: FieldValue.arrayRemove(...dead) });
  return res.successCount > 0;
}
