import { NextResponse, type NextRequest } from "next/server";
import { adminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME } from "@/lib/session";

/**
 * Server-side route protection (Next 16 `proxy`, formerly middleware; runs on Node.js,
 * so firebase-admin can verify the session cookie).
 *  - /dashboard/**  requires a valid session, else → /login
 *  - /login         with a valid session → /dashboard
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const cookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  let valid = false;
  if (cookie) {
    try {
      await adminAuth().verifySessionCookie(cookie); // signature + expiry; no revocation lookup
      valid = true;
    } catch {
      valid = false;
    }
  }

  if (pathname.startsWith("/login")) {
    if (valid) return NextResponse.redirect(new URL("/dashboard", request.url));
    const res = NextResponse.next();
    if (cookie) res.cookies.delete(SESSION_COOKIE_NAME); // drop expired/invalid cookie
    return res;
  }

  if (!valid) {
    const res = NextResponse.redirect(new URL("/login", request.url));
    if (cookie) res.cookies.delete(SESSION_COOKIE_NAME);
    return res;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/login"],
};
