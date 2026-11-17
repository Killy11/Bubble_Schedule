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

// Background (tab closed or hidden). The server sends DATA-ONLY messages
// ({ data: { title, body, url, blockId } }), so we build the notification here.
// If a message ever includes a `notification` block, the SDK shows it itself; skip to avoid a duplicate.
messaging.onBackgroundMessage((payload) => {
  if (payload.notification) return;
  const data = payload.data || {};
  return self.registration.showNotification(data.title || "BubbleSchedule", {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: data.blockId || undefined, // collapses repeats for the same block
    data: { url: data.url || "/dashboard?tab=schedule" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/dashboard", self.location.origin).href;
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
