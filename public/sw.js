const STATIC_CACHE = "chessriot-static-v1";
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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      const matching = typeof path === "string"
        ? clients.find((client) => new URL(client.url).pathname === path)
        : null;
      if (matching) return matching.focus();
      const existing = clients[0];
      if (existing && typeof path === "string") {
        const navigated = await existing.navigate(path);
        return navigated?.focus();
      }
      if (existing) return existing.focus();
      return self.clients.openWindow(typeof path === "string" ? path : "/");
    }),
  );
});
