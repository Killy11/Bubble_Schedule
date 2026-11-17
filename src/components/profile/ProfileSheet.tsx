"use client";

import { useState } from "react";
import { BellRing, Check, Clock, Download, Heart, Loader2, Mail, Share } from "lucide-react";
import { doc, updateDoc } from "firebase/firestore";
import { Sheet } from "@/components/Sheet";
import { db } from "@/lib/firebase/client";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useAuth } from "@/context/AuthProvider";
import { useInstall } from "@/context/InstallProvider";
import { useNotifications } from "@/context/NotificationProvider";

// Replace with your Stripe Payment Link / Buy Me a Coffee page (set NEXT_PUBLIC_SUPPORT_URL).
const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL || "https://buymeacoffee.com/your-name";

const primaryBtn =
  "flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition disabled:opacity-60";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Working-hours range picker; saved to users/{uid}.settings.workingHours and used by the AI planner. */
function WorkingHours({ uid, start: s0, end: e0 }: { uid: string; start: string; end: string }) {
  const [start, setStart] = useState(s0);
  const [end, setEnd] = useState(e0);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const valid = !!start && !!end && toMin(end) - toMin(start) >= 60;
  const dirty = start !== s0 || end !== e0;
  const input = "glass w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/30";

  async function save() {
    setState("saving");
    try {
      await updateDoc(doc(db, "users", uid), { "settings.workingHours": { start, end } });
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-medium"><Clock className="h-4 w-4" /> Working hours</p>
      <div className="flex items-center gap-2">
        <input type="time" aria-label="Working hours start" value={start} onChange={(e) => { setStart(e.target.value); setState("idle"); }} className={input} />
        <span className="text-sm text-muted">to</span>
        <input type="time" aria-label="Working hours end" value={end} onChange={(e) => { setEnd(e.target.value); setState("idle"); }} className={input} />
      </div>
      {!valid && <p className="text-xs text-red-500">End must be at least 1 hour after the start.</p>}
      {state === "error" && <p role="alert" className="text-xs text-red-500">Couldn&apos;t save. Try again.</p>}
      <button
        onClick={save}
        disabled={!valid || !dirty || state === "saving"}
        className={`${primaryBtn} glass hover:brightness-125`}
      >
        {state === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "saved" && !dirty ? <Check className="h-4 w-4" /> : null}
        {state === "saved" && !dirty ? "Saved" : "Save working hours"}
      </button>
      <p className="text-xs text-muted">The AI only schedules inside these hours. Existing blocks outside them are re-planned on the next scheduling.</p>
    </div>
  );
}

export function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { canInstall, installed, isIOS, install } = useInstall();
  const { permission, enabling, error, enable } = useNotifications();
  const [installing, setInstalling] = useState(false);
  const { settings } = useUserProfile(user?.uid);

  const name = user?.displayName || null;
  const email = user?.email || "—";
  const initial = (name || user?.email || "?")[0].toUpperCase();

  return (
    <Sheet open={open} onClose={onClose} title="Your profile">
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          {user?.photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="glass flex h-14 w-14 items-center justify-center rounded-full text-lg font-semibold">
              {initial}
            </div>
          )}
          <div className="min-w-0">
            <p className="break-words text-base font-semibold">{name ?? "No name set"}</p>
            <p className="flex items-center gap-1.5 break-all text-sm text-muted">
              <Mail className="h-3.5 w-3.5 shrink-0" /> {email}
            </p>
          </div>
        </div>

        {user && (
          <WorkingHours
            key={`${settings.workingHours?.start ?? "09:00"}-${settings.workingHours?.end ?? "18:00"}`}
            uid={user.uid}
            start={settings.workingHours?.start ?? "09:00"}
            end={settings.workingHours?.end ?? "18:00"}
          />
        )}

        <div className="space-y-3">
          {/* Install the PWA */}
          {installed ? (
            <div className={`${primaryBtn} glass text-muted`}>
              <Check className="h-4 w-4" /> App installed
            </div>
          ) : (
            <>
              <button
                disabled={!canInstall || installing}
                onClick={async () => {
                  setInstalling(true);
                  try { await install(); } finally { setInstalling(false); }
                }}
                className={`${primaryBtn} bg-foreground text-background hover:opacity-90`}
              >
                {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Install App
              </button>
              {!canInstall && (
                <p className="flex items-start gap-1.5 text-xs text-muted">
                  {isIOS ? (
                    <>
                      <Share className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      On iPhone/iPad: tap Share, then &ldquo;Add to Home Screen&rdquo;.
                    </>
                  ) : (
                    "Install isn't available right now. Use Chrome or Edge on the deployed (HTTPS) app, or your browser's menu."
                  )}
                </p>
              )}
            </>
          )}

          {/* Push notifications */}
          {permission !== "unsupported" && (
            <div>
              <button
                onClick={enable}
                disabled={enabling || permission === "granted"}
                className={`${primaryBtn} glass hover:brightness-125`}
              >
                {enabling ? <Loader2 className="h-4 w-4 animate-spin" /> : permission === "granted" ? <Check className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
                {permission === "granted" ? "Notifications on" : "Enable reminders"}
              </button>
              {permission === "denied" && !error && (
                <p className="mt-1.5 text-xs text-muted">Notifications are blocked in your browser settings for this site.</p>
              )}
              {error && <p role="alert" className="mt-1.5 text-xs text-red-500">{error}</p>}
            </div>
          )}

          {/* Donate */}
          <a
            href={SUPPORT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={`${primaryBtn} bg-[rgb(225_29_72)] text-white hover:brightness-110`}
          >
            <Heart className="h-4 w-4" /> Support the Project
          </a>
        </div>
      </div>
    </Sheet>
  );
}
