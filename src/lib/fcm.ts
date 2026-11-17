import { arrayRemove, arrayUnion, doc, setDoc } from "firebase/firestore";
import { deleteToken, getToken } from "firebase/messaging";
import { db, getClientMessaging } from "./firebase/client";

/** The scope the Firebase Messaging SDK expects its worker to have. */
export const FCM_SCOPE = "/firebase-cloud-messaging-push-scope";

/** True when this browser can do web push (service workers + Notifications + FCM). */
export async function fcmSupported(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return false;
  return (await getClientMessaging()) !== null;
}

/** Register firebase-messaging-sw.js in its own scope, passing Firebase config via the query string. */
async function registerMessagingSW(): Promise<ServiceWorkerRegistration> {
  const q = new URLSearchParams({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  });
  const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${q}`, {
    scope: FCM_SCOPE,
    updateViaCache: "none",
  });
  await waitForActive(registration);
  return registration;
}

/**
 * register() resolves while the worker is still installing, but PushManager.subscribe() needs an ACTIVE
 * worker ("Subscription failed - no active Service Worker"). Wait until it is active.
 */
function waitForActive(registration: ServiceWorkerRegistration, timeoutMs = 10_000): Promise<void> {
  if (registration.active) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const worker = registration.installing ?? registration.waiting;
    if (!worker) return reject(new Error("The notification service worker failed to start"));
    const timer = setTimeout(() => reject(new Error("The notification service worker took too long to start")), timeoutMs);
    const check = () => {
      if (worker.state === "activated") {
        clearTimeout(timer);
        resolve();
      } else if (worker.state === "redundant") {
        clearTimeout(timer);
        reject(new Error("The notification service worker could not be installed (check /firebase-messaging-sw.js loads)"));
      }
    };
    worker.addEventListener("statechange", check);
    check();
  });
}

/** Get (or create) this browser's FCM registration token. Permission must already be granted. */
export async function getFcmToken(): Promise<string | null> {
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) throw new Error("NEXT_PUBLIC_FIREBASE_VAPID_KEY is not set");
  const messaging = await getClientMessaging();
  if (!messaging) return null;
  const registration = await registerMessagingSW();
  return (await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration })) || null;
}

/** Ask for notification permission (call from a click) and return the resulting state. */
export async function requestPermission(): Promise<NotificationPermission> {
  return Notification.requestPermission();
}

/** Store the token in users/{uid}.fcmTokens and mark notifications as enabled. */
export async function saveToken(uid: string, token: string): Promise<void> {
  await setDoc(
    doc(db, "users", uid),
    { fcmTokens: arrayUnion(token), settings: { notificationsEnabled: true } },
    { merge: true },
  );
}

/** On sign-out: drop this device's token from the user and revoke it, so the next user here isn't pushed A's reminders. */
export async function removeToken(uid: string): Promise<void> {
  if (!(await fcmSupported()) || Notification.permission !== "granted") return;
  const token = await getFcmToken().catch(() => null);
  if (!token) return;
  await setDoc(doc(db, "users", uid), { fcmTokens: arrayRemove(token) }, { merge: true });
  const messaging = await getClientMessaging();
  if (messaging) await deleteToken(messaging).catch(() => {});
}
