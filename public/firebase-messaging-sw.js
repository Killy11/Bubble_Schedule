// Firebase Cloud Messaging service worker.
// Registered by src/lib/fcm.ts with scope "/firebase-cloud-messaging-push-scope" (the scope the
// Firebase SDK expects), and given its Firebase config through the URL query string because a
// worker cannot read process.env.
importScripts("https://www.gstatic.com/firebasejs/13.3.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/13.3.0/firebase-messaging-compat.js");

const params = new URL(self.location.href).searchParams;
firebase.initializeApp({
  apiKey: params.get("apiKey"),
  projectId: params.get("projectId"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
});
const messaging = firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Background (tab closed or hidden). The server sends DATA-ONLY messages, so we build the notification here:
// { title, body, url, blockId, actionToken, doneLabel, snoozeLabel }. The two buttons call the signed action
// endpoint directly, so they work without opening the app.
// If a message ever includes a `notification` block, the SDK shows it itself; skip to avoid a duplicate.
messaging.onBackgroundMessage((payload) => {
  if (payload.notification) return;
  const data = payload.data || {};
  const actions = [];
  if (data.actionToken && data.doneLabel) actions.push({ action: "done", title: data.doneLabel });
  if (data.actionToken && data.snoozeLabel) actions.push({ action: "snooze", title: data.snoozeLabel });
  return self.registration.showNotification(data.title || "BubbleSchedule", {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.blockId || undefined, // collapses repeats for the same item
    actions,
    data: { url: data.url || "/dashboard", token: data.actionToken || "" },
  });
});

async function runAction(action, token) {
  try {
    const res = await fetch("/api/notifications/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, action }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

self.addEventListener("notificationclick", (event) => {
  const n = event.notification;
  n.close();
  const { url, token } = n.data || {};

  // A button was pressed: do it in the background and leave the app closed.
  if ((event.action === "done" || event.action === "snooze") && token) {
    event.waitUntil(
      runAction(event.action, token).then((ok) => {
        if (ok) return;
        // The link expired or the network failed: fall back to opening the app.
        return self.clients.openWindow(new URL(url || "/dashboard", self.location.origin).href);
      }),
    );
    return;
  }

  // The notification body: open or focus BubbleSchedule.
  const target = new URL(url || "/dashboard", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          return w.navigate(target).then((c) => (c || w).focus());
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
