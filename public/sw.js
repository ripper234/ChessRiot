const STATIC_CACHE = "chessriot-static-v1";
const GAME_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRECACHE = [
  "/manifest.webmanifest",
  "/icons/chessriot-192.png",
  "/icons/chessriot-512.png",
  "/icons/chessriot-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith("chessriot-static-") && key !== STATIC_CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

async function fetchAndCache(request) {
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const cacheable = (
    url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/icons/")
    || url.pathname === "/manifest.webmanifest"
  );
  if (!cacheable) return;
  const network = fetchAndCache(request);
  event.waitUntil(network.then(() => undefined).catch(() => undefined));
  event.respondWith(
    caches.match(request).then((cached) => cached ?? network),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }
  const gameId = typeof payload.gameId === "string" && GAME_ID_PATTERN.test(payload.gameId)
    ? payload.gameId
    : null;
  const path = gameId ? `/g/${gameId}` : "/app";
  event.waitUntil(
    self.registration.showNotification("ChessRiot", {
      body: "It’s your turn.",
      icon: "/icons/chessriot-192.png",
      badge: "/icons/chessriot-192.png",
      tag: gameId ? `turn-${gameId}` : "chessriot-turn",
      data: { path },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const candidate = event.notification.data?.path;
  const path = (
    candidate === "/app"
    || (
      typeof candidate === "string"
      && candidate.startsWith("/g/")
      && GAME_ID_PATTERN.test(candidate.slice(3))
    )
  ) ? candidate : "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const matching = clients.find((client) => new URL(client.url).pathname === path);
      if (matching) return matching.focus();
      const existing = clients[0];
      if (existing) {
        const navigated = await existing.navigate(path);
        return navigated?.focus();
      }
      return self.clients.openWindow(path);
    }),
  );
});
