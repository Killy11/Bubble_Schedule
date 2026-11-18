import "server-only";
import { cookies } from "next/headers";
import { adminAuth } from "./admin";
import { SESSION_COOKIE_NAME } from "@/lib/session";

/** uid of the signed-in user from the session cookie, or null. For route handlers. */
export async function getSessionUid(): Promise<string | null> {
  const cookie = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!cookie) return null;
  try {
    return (await adminAuth().verifySessionCookie(cookie)).uid;
  } catch {
    return null;
  }
}
