"use client";

import { useState } from "react";
import { BellRing, Check, Clock, Download, Globe, Loader2, Mail, MessageSquarePlus, Share } from "lucide-react";
import { doc, updateDoc } from "firebase/firestore";
import { Sheet } from "@/components/Sheet";
import { db } from "@/lib/firebase/client";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useAuth } from "@/context/AuthProvider";
import { useInstall } from "@/context/InstallProvider";
import { useNotifications } from "@/context/NotificationProvider";
import { SupportButton } from "@/components/SupportButton";
import { useLang } from "@/context/LanguageProvider";

const primaryBtn =
  "flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition disabled:opacity-60";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Working-hours range picker; saved to users/{uid}.settings.workingHours and used by the AI planner. */
function WorkingHours({ uid, start: s0, end: e0 }: { uid: string; start: string; end: string }) {
  const { t } = useLang();
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
      <p className="flex items-center gap-1.5 text-sm font-medium"><Clock className="h-4 w-4" /> {t("Working hours")}</p>
      <div className="flex items-center gap-2">
        <input type="time" aria-label={t("Working hours")} value={start} onChange={(e) => { setStart(e.target.value); setState("idle"); }} className={input} />
        <span className="text-sm text-muted">–</span>
        <input type="time" aria-label={t("Working hours")} value={end} onChange={(e) => { setEnd(e.target.value); setState("idle"); }} className={input} />
      </div>
      {!valid && <p className="text-xs text-red-500">{t("At least 1 hour")}</p>}
      {state === "error" && <p role="alert" className="text-xs text-red-500">{t("Couldn't save. Please try again.")}</p>}
      <button
        onClick={save}
        disabled={!valid || !dirty || state === "saving"}
        className={`${primaryBtn} glass hover:brightness-125`}
      >
        {state === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "saved" && !dirty ? <Check className="h-4 w-4" /> : null}
        {state === "saved" && !dirty ? t("Saved") : t("Save")}
      </button>
    </div>
  );
}

export function ProfileSheet({ open, onClose, onOpenFeedback }: { open: boolean; onClose: () => void; onOpenFeedback: () => void }) {
  const { t, lang, setLang } = useLang();
  const { user } = useAuth();
  const { canInstall, installed, isIOS, install } = useInstall();
  const { permission, enabling, error, enable } = useNotifications();
  const [installing, setInstalling] = useState(false);
  const { settings } = useUserProfile(user?.uid);

  const name = user?.displayName || null;
  const email = user?.email || "—";
  const initial = (name || user?.email || "?")[0].toUpperCase();

  return (
    <Sheet open={open} onClose={onClose} title={t("Profile")}>
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
            <p className="break-words text-base font-semibold">{name ?? "—"}</p>
            <p className="flex items-center gap-1.5 break-all text-sm text-muted">
              <Mail className="h-3.5 w-3.5 shrink-0" /> {email}
            </p>
          </div>
        </div>

        {/* Interface language: English by default; saved on this device and in the account. */}
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-medium"><Globe className="h-4 w-4" /> {t("Language")}</p>
          <div role="radiogroup" aria-label={t("Language")} className="glass flex rounded-full p-1">
            {([["en", "English"], ["uk", "Українська"]] as const).map(([code, label]) => (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={lang === code}
                onClick={() => {
                  setLang(code);
                  if (user) updateDoc(doc(db, "users", user.uid), { "settings.language": code }).catch((e) => console.warn("language save:", e));
                }}
                className={`flex-1 rounded-full px-3 py-1.5 text-sm transition ${
                  lang === code ? "bg-foreground font-medium text-background" : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {user && (
          <WorkingHours
            key={`${settings.workingHours?.start ?? "09:00"}-${settings.workingHours?.end ?? "21:00"}`}
            uid={user.uid}
            start={settings.workingHours?.start ?? "09:00"}
            end={settings.workingHours?.end ?? "21:00"}
          />
        )}

        <div className="space-y-3">
          {/* Install the PWA */}
          {installed ? (
            <div className={`${primaryBtn} glass text-muted`}>
              <Check className="h-4 w-4" /> {t("App installed")}
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
                {t("Install app")}
              </button>
              {!canInstall && isIOS && (
                <p className="flex items-start gap-1.5 text-xs text-muted">
                  <Share className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("Share → Add to Home Screen")}
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
                {permission === "granted" ? t("Notifications on") : t("Enable reminders")}
              </button>
              {permission === "denied" && !error && (
                <p className="mt-1.5 text-xs text-muted">{t("Notifications are blocked in browser settings")}</p>
              )}
              {error && <p role="alert" className="mt-1.5 text-xs text-red-500">{error}</p>}
            </div>
          )}

          <SupportButton variant="block" />
          <button
            type="button"
            onClick={() => { onClose(); onOpenFeedback(); }}
            className={`${primaryBtn} glass hover:brightness-125`}
          >
            <MessageSquarePlus className="h-4 w-4" /> {t("Feedback")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
