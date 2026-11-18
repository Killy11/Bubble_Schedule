import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { adminAuth } from "@backend/firebase/admin";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from "@/lib/session";
import type { SessionRequest } from "@/types/api";

/** POST: exchange a fresh Firebase ID token for an httpOnly session cookie. */
export async function POST(request: Request) {
  let idToken: string | undefined;
  try {
    idToken = ((await request.json()) as Partial<SessionRequest>).idToken;
  } catch {
    /* fall through */
  }
  if (!idToken) {
    return NextResponse.json({ error: "Missing idToken" }, { status: 400 });
  }

  try {
    const auth = adminAuth();
    const decoded = await auth.verifyIdToken(idToken);
    // Only mint sessions from a recent sign-in (Firebase's recommendation).
    if (Date.now() / 1000 - decoded.auth_time > 5 * 60) {
      return NextResponse.json({ error: "Recent sign-in required" }, { status: 401 });
    }
    const sessionCookie = await auth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_MS,
    });
    (await cookies()).set(SESSION_COOKIE_NAME, sessionCookie, {
      maxAge: SESSION_MAX_AGE_MS / 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}

/** DELETE: sign out (clear the cookie). */
export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE_NAME);
  return NextResponse.json({ ok: true });
}
