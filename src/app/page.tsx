import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SESSION_COOKIE_NAME } from "@/lib/session";

async function Redirector(): Promise<null> {
  const hasSession = (await cookies()).has(SESSION_COOKIE_NAME);
  // Presence only: proxy.ts does the real verification on /dashboard and /login.
  redirect(hasSession ? "/dashboard" : "/login");
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <Redirector />
    </Suspense>
  );
}
