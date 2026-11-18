"use client";

import { useState } from "react";
import { BellRing, Check, Clock, Download, Globe, Loader2, Mail, MessageSquarePlus, Moon, Share } from "lucide-react";
import { doc, updateDoc } from "firebase/firestore";
import { Sheet } from "@/components/Sheet";
import { db } from "@/lib/firebase/client";
import { hhmm } from "@/lib/time";
import { showLocalNotification } from "@/lib/localNotify";
import { derivedQuiet, effectiveQuiet } from "@/lib/settings";
import type { UserSettings } from "@/types";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useAuth } from "@/context/AuthProvider";
import { useInstall } from "@/context/InstallProvider";
import { useNotifications } from "@/context/NotificationProvider";
import { SupportButton } from "@/components/SupportButton";
import { useLang } from "@/context/LanguageProvider";

const primaryBtn =
  "flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition disabled:opacity-60";

/** A labelled On / Off switch row. */
function Switch({
  icon, label, hint, on, disabled, onChange,
}: {
  icon: React.ReactNode; label: string; hint?: string; on: boolean; disabled?: boolean; onChange: (next: boolean) => void;
}) {
  const { t } = useLang();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="glass flex w-full items-center gap-3 rounded-2xl p-3 text-left transition disabled:opacity-60"
    >
      <span className="text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span className="text-xs text-muted">{on ? t("On") : t("Off")}</span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-foreground" : "bg-muted/40"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-background shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** Quiet hours: On/Off, plus start and end times that follow the schedule until the user picks their own. */
function QuietHours({ uid, settings }: { uid: string; settings: UserSettings }) {
  const { t } = useLang();
  const q = effectiveQuiet(settings);
  const derived = derivedQuiet(settings);
  const save = (patch: Record<string, unknown>) =>
    updateDoc(doc(db, "users", uid), Object.fromEntries(Object.entries(patch).map(([k, v]) => [`settings.${k}`, v]))).catch((e) =>
      console.warn("quiet hours save:", e),
    );
  const input = "glass w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-foreground/30 [color-scheme:dark]";
  return (
    <div className="space-y-2">
      <Switch
        icon={<Moon className="h-4 w-4" />}
        label={t("Quiet hours")}
        hint={`${q.start} – ${q.end}`}
        on={q.enabled}
        onChange={(next) => void save({ quietHoursEnabled: next, quietHoursStart: q.start, quietHoursEnd: q.end })}
      />
      <p className="mb-2.5 mt-1 px-1 text-xs leading-relaxed text-zinc-400">
        {t("Quiet window: the 1-day deadline reminder waits until it ends. Task start alerts still come through, and scheduling isn't affected.")}
      </p>
      {q.enabled && (
        <div className="space-y-1.5 px-1">
          <div className="flex items-center gap-2">
            <input type="time" step={60} aria-label={t("Start")} value={hhmm(q.start)} className={input}
              onChange={(e) => e.target.value && void save({ quietHoursCustom: true, quietHoursStart: e.target.value, quietHoursEnd: q.end })} />
            <span className="text-sm text-muted">–</span>
            <input type="time" step={60} aria-label={t("End")} value={hhmm(q.end)} className={input}
              onChange={(e) => e.target.value && void save({ quietHoursCustom: true, quietHoursStart: q.start, quietHoursEnd: e.target.value })} />
          </div>
          {q.custom && (
            <button type="button" className="text-xs text-muted underline-offset-2 transition hover:text-foreground hover:underline"
              onClick={() => void save({ quietHoursCustom: false, quietHoursStart: derived.start, quietHoursEnd: derived.end })}>
              {t("Auto from schedule")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Notification status, the enable button, a test button, the master switch and Quiet hours. */
function NotificationsCard({
  uid, settings, permission, enabling, error, enable, disable, iosNeedsInstall,
}: {
  uid: string;
  settings: UserSettings;
  permission: NotificationPermission | "unsupported";
  enabling: boolean;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  iosNeedsInstall: boolean;
}) {
  const { t, lang } = useLang();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const on = settings.notificationsEnabled && permission === "granted";

  /** Sends a real push to this account's devices. If that fails, a local notification still proves the device can show one. */
  async function sendTest() {
    setTesting(true);
    setResult(null);
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang }),
      });
      if (res.ok) {
        setResult({ ok: true, text: t("Test sent. It should arrive in a few seconds.") });
      } else {
        const reason = ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "";
        const shown = await showLocalNotification(lang === "uk" ? "🔔 Тестове сповіщення" : "🔔 Test notification", lang === "uk" ? "Локальний тест: цей пристрій може показувати сповіщення." : "Local test: this device can show notifications.", `test_${uid}`);
        setResult({ ok: false, text: `${t("Push delivery failed")}${reason ? `: ${t(reason)}` : ""}${shown ? ` (${t("Shown on this device only.")})` : ""}` });
      }
    } catch {
      setResult({ ok: false, text: t("Push delivery failed") });
    } finally {
      setTesting(false);
    }
  }

  if (permission === "unsupported") {
    return iosNeedsInstall ? (
      <p className="flex items-start gap-1.5 text-xs text-muted">
        <Share className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {t("On iPhone, add the site to your Home Screen (Share → Add to Home Screen) to receive notifications.")}
      </p>
    ) : null;
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-medium"><BellRing className="h-4 w-4" /> {t("Notifications")}</p>

      {permission === "denied" ? (
        <p role="status" className="rounded-2xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500">
          {t("🚫 Blocked in browser settings — allow notifications near the address bar")}
        </p>
      ) : on ? (
        <>
          <p role="status" className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
            {t("✅ Notifications active on this device")}
          </p>
          <Switch
            icon={enabling ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            label={t("Notifications")}
            on
            disabled={enabling}
            onChange={() => void disable()}
          />
          <button
            type="button"
            onClick={sendTest}
            disabled={testing}
            className={`${primaryBtn} glass hover:brightness-125`}
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("🔔 Send test notification")}
          </button>
          {result && (
            <p role="status" className={`text-xs ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>{result.text}</p>
          )}
          <QuietHours uid={uid} settings={settings} />
        </>
      ) : (
        <button type="button" onClick={() => void enable()} disabled={enabling} className={`${primaryBtn} bg-foreground text-background hover:opacity-90`}>
          {enabling ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} {t("Enable notifications")}
        </button>
      )}

      {iosNeedsInstall && (
        <p className="flex items-start gap-1.5 text-xs text-muted">
          <Share className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {t("On iPhone, add the site to your Home Screen (Share → Add to Home Screen) to receive notifications.")}
        </p>
      )}
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Working-hours range picker; saved to users/{uid}.settings.workingHours and used by the AI planner. */
function WorkingHours({ uid, start: s0, end: e0, quietCustom }: { uid: string; start: string; end: string; quietCustom: boolean }) {
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
      await updateDoc(doc(db, "users", uid), {
        "settings.workingHours": { start, end },
        // Quiet hours follow the schedule (end of day → start of day) until the user sets their own.
        ...(quietCustom ? {} : { "settings.quietHoursStart": end, "settings.quietHoursEnd": start }),
      });
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-medium"><Clock className="h-4 w-4" /> {t("Working hours")}</p>
      <div className="flex items-center gap-2">
        <input type="time" step={60} aria-label={t("Working hours")} value={hhmm(start)} onChange={(e) => { setStart(e.target.value); setState("idle"); }} className={input} />
        <span className="text-sm text-muted">–</span>
        <input type="time" step={60} aria-label={t("Working hours")} value={hhmm(end)} onChange={(e) => { setEnd(e.target.value); setState("idle"); }} className={input} />
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

export function ProfileSheet({ open, onClose, onOpenFeedback, onShowTutorial }: { open: boolean; onClose: () => void; onOpenFeedback: () => void; onShowTutorial: () => void }) {
  const { t, lang, setLang } = useLang();
  const { user } = useAuth();
  const { canInstall, installed, isIOS, install } = useInstall();
  const { permission, enabling, error, enable, disable } = useNotifications();
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
            quietCustom={settings.quietHoursCustom === true}
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

          {/* Notifications: real browser state, enable, test, master switch, Quiet Hours */}
          {user && (
            <NotificationsCard
              uid={user.uid}
              settings={settings}
              permission={permission}
              enabling={enabling}
              error={error}
              enable={enable}
              disable={disable}
              iosNeedsInstall={isIOS && !installed}
            />
          )}

          <button type="button" onClick={onShowTutorial} className={`${primaryBtn} glass hover:brightness-125`}>
            {t("🎓 Show the interactive guide")}
          </button>
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
