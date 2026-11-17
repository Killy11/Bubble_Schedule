"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { onMessage } from "firebase/messaging";
import { useAuth } from "@/context/AuthProvider";
import { useToast } from "@/context/ToastProvider";
import { getClientMessaging } from "@/lib/firebase/client";
import { fcmSupported, getFcmToken, requestPermission, saveToken } from "@/lib/fcm";

type Permission = NotificationPermission | "unsupported";

interface NotificationContextValue {
  permission: Permission;
  enabling: boolean;
  error: string | null;
  /** Ask for permission (must run from a click), fetch the FCM token and save it on the user. */
  enable: () => Promise<void>;
}
const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const uid = user?.uid;

  const [permission, setPermission] = useState<Permission>("default");
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncedFor = useRef<string | null>(null);

  // Detect support + current permission once.
  useEffect(() => {
    fcmSupported().then((ok) => setPermission(ok ? Notification.permission : "unsupported"));
  }, []);

  // Already granted earlier? Refresh the token (tokens rotate) and make sure it is saved for this user.
  useEffect(() => {
    if (!uid || permission !== "granted" || syncedFor.current === uid) return;
    syncedFor.current = uid;
    getFcmToken()
      .then((token) => (token ? saveToken(uid, token) : undefined))
      .catch((e) => console.warn("fcm token sync:", e instanceof Error ? e.message : e));
  }, [uid, permission]);

  // Foreground messages: the worker only handles background, so show an in-app toast here.
  useEffect(() => {
    if (!uid || permission !== "granted") return;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    getClientMessaging().then((messaging) => {
      if (!messaging || cancelled) return;
      unsubscribe = onMessage(messaging, (payload) => {
        const d = payload.data ?? {};
        const title = d.title ?? payload.notification?.title ?? "BubbleSchedule";
        const body = d.body ?? payload.notification?.body;
        toast({ title, body, onClick: () => router.push(d.url ?? "/dashboard") });
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [uid, permission, toast, router]);

  const enable = useCallback(async () => {
    if (!uid) return;
    setError(null);
    setEnabling(true);
    try {
      const result = await requestPermission();
      setPermission(result);
      if (result !== "granted") {
        setError(result === "denied" ? "Notifications are blocked. Allow them in your browser's site settings." : null);
        return;
      }
      const token = await getFcmToken();
      if (!token) throw new Error("This browser can't receive push notifications.");
      await saveToken(uid, token);
      syncedFor.current = uid;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't enable notifications.");
    } finally {
      setEnabling(false);
    }
  }, [uid]);

  const value = useMemo(() => ({ permission, enabling, error, enable }), [permission, enabling, error, enable]);
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationProvider>");
  return ctx;
}
