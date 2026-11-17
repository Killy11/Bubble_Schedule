// BubbleSchedule service worker: caches static assets and provides an offline fallback.
//
// What is cached:   app icons + offline page (precached), and Next's hashed build assets
//                   (/_next/static/**: JS, CSS, fonts) on first use.
// What is NOT:      /api/**, Firestore/Auth traffic, and HTML pages. Pages are per-user and
//                   behind a session cookie, so they always go to the network; if the network is
//                   down, navigations fall back to /offline.html.
// Bump VERSION to drop all old caches on the next activation.
const VERSION = "v1";
const STATIC_CACHE = `bubbleschedule-static-${VERSION}`;
const MAX_STATIC_ENTRIES = 150;

const PRECACHE = [
  "/offline.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("bubbleschedule-") && k !== STATIC_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trim(cache, max) {
  const keys = await cache.keys();
  // Oldest entries are first; drop the excess.
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trim(cache, MAX_STATIC_ENTRIES);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Firebase, Google, OpenAI: never touched
  if (url.pathname.startsWith("/api/")) return;

  // Page loads: network only, with an offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  // Immutable build assets and icons: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request));
  }
});
