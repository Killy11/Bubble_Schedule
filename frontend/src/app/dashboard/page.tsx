import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Orb } from "@/components/Orb";

export const metadata: Metadata = { title: "Dashboard · BubbleSchedule" };

// Auth is enforced server-side by src/proxy.ts (no valid session cookie → /login).
// The shell reads the clock, so with Cache Components it must render at request time (Suspense).
export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center">
          <Orb hue="green" size={64} className="animate-pulse" />
        </div>
      }
    >
      <DashboardShell />
    </Suspense>
  );
}
