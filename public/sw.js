const STATIC_CACHE = "chessriot-static-v2";
const PUSH_CONSENT_CACHE = "chessriot-push-consent-v1";
const PUSH_CONSENT_PATH = "/__chessriot_push_consent__";
const PUSH_DIAGNOSTIC_WORKER_VERSION = "0.30.1";
const PUSH_DIAGNOSTIC_RECEIPT_TYPE = "chessriot:push-diagnostic-receipt";
const LOCAL_PUSH_DIAGNOSTIC_EVENT_TYPE = "chessriot:local-push-diagnostic-event";
const PUSH_DIAGNOSTIC_WORKER_VERSION_REQUEST_TYPE = "chessriot:push-worker-version-request";
const PUSH_DIAGNOSTIC_WORKER_VERSION_RESPONSE_TYPE = "chessriot:push-worker-version-response";
const GAME_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRECACHE = [
  "/manifest.webmanifest",
  "/icons/chessriot-192.png",
  "/icons/chessriot-512.png",
  "/icons/chessriot-maskable-512.png",
];
const turnNotificationOperations = new Map();

function serializeTurnNotification(tag, operation) {
  const previous = turnNotificationOperations.get(tag) ?? Promise.resolve();
  const completion = previous.then(operation, operation);
  const settled = completion.catch(() => undefined);
  turnNotificationOperations.set(tag, settled);
  settled.then(() => {
    if (turnNotificationOperations.get(tag) === settled) {
      turnNotificationOperations.delete(tag);
    }
  });
  return completion;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => Promise.allSettled(PRECACHE.map((path) => cache.add(path))))
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

async function postPushDiagnosticStage(
  notificationId,
  stage,
  type = PUSH_DIAGNOSTIC_RECEIPT_TYPE,
) {
  let clients = [];
  try {
    clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
  } catch {
    return;
  }
  for (const client of clients) {
    try {
      client.postMessage({
        type,
        notificationId,
        stage,
      });
    } catch {
      // One stale client cannot block notification creation or other clients.
    }
  }
}

async function recordTurnTestReceipt(gameId, gameVersion, changes) {
  return serializeTurnNotification(`receipt-${gameId}-${gameVersion}`, async () => {
  try {
    const cache = await caches.open("chessriot-turn-test-v1");
    const path = `/__chessriot_turn_test__/${gameId}/${gameVersion}`;
    const previous = await cache.match(path);
    const data = previous ? await previous.json() : {};
    await cache.put(path, new Response(JSON.stringify({ ...changes, ...data })));
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - 80))) await cache.delete(key);
  } catch {
    // Missing diagnostic storage must never prevent the real notification.
  }
  });
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {};
  }
  const gameId = payload.type === "your_turn"
    && typeof payload.gameId === "string"
    && GAME_ID_PATTERN.test(payload.gameId)
    ? payload.gameId
    : null;
  const gameVersion = gameId
    && Number.isSafeInteger(payload.gameVersion)
    && payload.gameVersion >= 0
    ? payload.gameVersion
    : null;
  const serviceBody = payload.type === "service"
    && typeof payload.body === "string"
    && payload.body === payload.body.trim()
    && Array.from(payload.body).length >= 1
    && Array.from(payload.body).length <= 120
    && !/[\r\n\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u.test(payload.body)
    ? payload.body
    : null;
  const friendRequest = payload.type === "friend_request"
    && typeof payload.senderUsername === "string"
    && Array.from(payload.senderUsername).length >= 1
    && Array.from(payload.senderUsername).length <= 64
    && !/[\r\n\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u.test(payload.senderUsername)
    && typeof payload.requestId === "string"
    && GAME_ID_PATTERN.test(payload.requestId)
    ? { senderUsername: payload.senderUsername, requestId: payload.requestId }
    : null;
  if (!gameId && !serviceBody && !friendRequest) return;
  const notificationId = typeof payload.notificationId === "string"
    && /^[A-Za-z0-9_-]{16,64}$/.test(payload.notificationId)
    ? payload.notificationId
    : "message";
  const diagnosticId = payload.type === "service"
    && typeof payload.diagnosticId === "string"
    && payload.diagnosticId === notificationId
    && GAME_ID_PATTERN.test(payload.diagnosticId)
    ? payload.diagnosticId
    : null;
  const path = gameId ? `/g/${gameId}` : friendRequest ? "/?activity=1" : "/app";
  const body = gameId
    ? "It’s your turn."
    : friendRequest
      ? `@${friendRequest.senderUsername} sent you a friend request.`
      : serviceBody;
  const tag = gameId
    ? `turn-${gameId}`
    : friendRequest
      ? `friend-request-${friendRequest.requestId}`
      : `service-${notificationId}`;
  const testTurn = gameId && gameVersion !== null && payload.notificationTest === true;
  const display = async () => {
    if (testTurn) {
      let visibleClients = null;
      let windowClients = null;
      try {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        windowClients = windows.length;
        visibleClients = windows.filter((client) => client.visibilityState === "visible").length;
      } catch { /* Unknown is not a closed-app pass. */ }
      await recordTurnTestReceipt(gameId, gameVersion, { receivedAt: Date.now(), visibleClients, windowClients });
    }
    if (diagnosticId) await postPushDiagnosticStage(diagnosticId, "push_received");
    let renotify = false;
    let suppressStaleTurn = false;
    if (gameId) {
      try {
        const retained = await self.registration.getNotifications({ tag });
        if (retained.length > 0) {
          const retainedVersions = retained
            .map((notification) => notification.data?.gameVersion)
            .filter((version) => Number.isSafeInteger(version) && version >= 0);
          if (retainedVersions.length > 0) {
            const newestRetainedVersion = Math.max(...retainedVersions);
            suppressStaleTurn = gameVersion === null || gameVersion < newestRetainedVersion;
            renotify = gameVersion !== null && gameVersion > newestRetainedVersion;
          } else {
            // A pre-version notification may represent an earlier turn, so prefer a fresh alert.
            renotify = true;
          }
        }
      } catch {
        // Prefer a possible duplicate alert over silently replacing a newer turn.
        renotify = true;
      }
    }
    if (suppressStaleTurn) return;
    try {
      await self.registration.showNotification("ChessRiot", {
        body,
        tag,
        icon: "/icons/chessriot-192.png",
        ...(gameId && renotify ? { renotify: true } : {}),
        ...(serviceBody ? { requireInteraction: true } : {}),
        data: {
          path,
          ...(gameVersion === null ? {} : { gameVersion }),
          ...(testTurn ? { testGameId: gameId } : {}),
          ...(diagnosticId ? { diagnosticId } : {}),
        },
      });
    } catch (error) {
      if (testTurn) await recordTurnTestReceipt(gameId, gameVersion, { showRejectedAt: Date.now() });
      if (diagnosticId) await postPushDiagnosticStage(diagnosticId, "show_rejected");
      throw error;
    }
    if (testTurn) await recordTurnTestReceipt(gameId, gameVersion, { shownAt: Date.now() });
    if (!diagnosticId) return;
    await postPushDiagnosticStage(diagnosticId, "show_resolved");
    const active = await self.registration.getNotifications({ tag });
    const notificationActive = active.some((notification) => notification.tag === tag);
    await postPushDiagnosticStage(
      diagnosticId,
      notificationActive ? "notification_active" : "notification_missing",
    );
  };
  event.waitUntil(gameId ? serializeTurnNotification(tag, display) : display());
});

function applicationServerKeyBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function readPushConsent(cache) {
  try {
    const response = await cache.match(PUSH_CONSENT_PATH);
    return response ? JSON.parse(await response.text()) : null;
  } catch {
    return null;
  }
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const consentCache = await caches.open(PUSH_CONSENT_CACHE);
    const consent = await readPushConsent(consentCache);
    if (
      consent?.version !== 2
      || typeof consent.token !== "string"
      || typeof consent.username !== "string"
      || consent.username.length === 0
    ) {
      return;
    }
    let subscription = event.newSubscription ?? null;
    try {
      const configResponse = await fetch("/api/push/config", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const config = configResponse.ok ? await configResponse.json() : null;
      if (config?.enabled !== true || typeof config.publicKey !== "string") {
        return;
      }
      subscription ??= await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKeyBytes(config.publicKey),
      });
      const latestConsent = await readPushConsent(consentCache);
      if (
        latestConsent?.token !== consent.token
        || latestConsent.username !== consent.username
      ) return;
      const serialized = subscription.toJSON();
      if (
        typeof serialized.endpoint !== "string"
        || typeof serialized.keys?.p256dh !== "string"
        || typeof serialized.keys?.auth !== "string"
      ) throw new Error("Incomplete replacement subscription");
      const response = await fetch("/api/me/push-devices", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          expectedUsername: consent.username,
          subscription: {
            endpoint: serialized.endpoint,
            expirationTime: subscription.expirationTime,
            keys: {
              p256dh: serialized.keys.p256dh,
              auth: serialized.keys.auth,
            },
          },
        }),
      });
      if (!response.ok) throw new Error("Replacement subscription was rejected");
      const finalConsent = await readPushConsent(consentCache);
      const newerConsentForSameOwner = finalConsent?.version === 2
        && typeof finalConsent.token === "string"
        && finalConsent.token !== consent.token
        && finalConsent.username === consent.username;
      if (finalConsent?.token !== consent.token && !newerConsentForSameOwner) {
        await fetch("/api/me/push-devices", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            endpoint: serialized.endpoint,
            expectedUsername: consent.username,
            preserveLegacy: true,
          }),
        });
      }
    } catch {
      // Leave a failed replacement inert. Page-open reconciliation can adopt or
      // remove it without a stale worker deleting a newer account's consent.
    }
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === PUSH_DIAGNOSTIC_WORKER_VERSION_REQUEST_TYPE) {
    event.ports?.[0]?.postMessage({
      type: PUSH_DIAGNOSTIC_WORKER_VERSION_RESPONSE_TYPE,
      version: PUSH_DIAGNOSTIC_WORKER_VERSION,
    });
    return;
  }
  if (
    event.data?.type !== "clear-turn-notification"
    || typeof event.data.gameId !== "string"
    || !GAME_ID_PATTERN.test(event.data.gameId)
    || !Number.isSafeInteger(event.data.gameVersion)
    || event.data.gameVersion < 0
  ) return;
  const tag = `turn-${event.data.gameId}`;
  event.waitUntil(
    serializeTurnNotification(tag, () => self.registration.getNotifications({ tag })
      .then((notifications) => notifications.forEach((notification) => {
        const retainedVersion = notification.data?.gameVersion;
        // Viewing the current turn is not an acknowledgement. Only a newer
        // authoritative position proves that this reminder is obsolete.
        if (Number.isSafeInteger(retainedVersion) && retainedVersion >= 0
          && retainedVersion < event.data.gameVersion) {
          notification.close();
        }
      }))),
  );
});

self.addEventListener("notificationclick", (event) => {
  const diagnosticId = event.notification.data?.diagnosticId;
  const localDiagnosticId = event.notification.data?.localDiagnosticId;
  const remoteDiagnostic = typeof diagnosticId === "string" && GAME_ID_PATTERN.test(diagnosticId);
  const localDiagnostic = typeof localDiagnosticId === "string" && GAME_ID_PATTERN.test(localDiagnosticId);
  if (!remoteDiagnostic && !localDiagnostic) event.notification.close();
  const candidate = event.notification.data?.path;
  const path = (
    candidate === "/?activity=1"
    || candidate === "/app"
    || (
      typeof candidate === "string"
      && candidate.startsWith("/g/")
      && GAME_ID_PATTERN.test(candidate.slice(3))
    )
  ) ? candidate : "/app";
  event.waitUntil((async () => {
    const testGameId = event.notification.data?.testGameId;
    const testVersion = event.notification.data?.gameVersion;
    if (typeof testGameId === "string" && GAME_ID_PATTERN.test(testGameId)
      && path === `/g/${testGameId}` && Number.isSafeInteger(testVersion) && testVersion >= 0) {
      await recordTurnTestReceipt(testGameId, testVersion, { clickedAt: Date.now() });
    }
    if (localDiagnostic) {
      await postPushDiagnosticStage(
        localDiagnosticId,
        "notification_clicked",
        LOCAL_PUSH_DIAGNOSTIC_EVENT_TYPE,
      );
    }
    if (remoteDiagnostic) {
      await postPushDiagnosticStage(diagnosticId, "notification_clicked");
    }
    if (remoteDiagnostic || localDiagnostic) event.notification.close();
    let clients = [];
    try {
      clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    } catch {
      // Android may retire clients between the click and enumeration.
    }
    const matching = clients.find((client) => {
      try {
        const clientUrl = new URL(client.url);
        return `${clientUrl.pathname}${clientUrl.search}` === path;
      } catch {
        return false;
      }
    });
    if (matching) {
      try {
        return await matching.focus();
      } catch {
        // A suspended client may no longer be focusable. Open the exact game.
      }
    }
    const existing = clients.find((client) => client.visibilityState === "visible") ?? clients[0];
    if (existing) {
      try {
        const navigated = await existing.navigate(path);
        if (navigated) return await navigated.focus();
      } catch {
        // Open a new window when Android refuses to navigate an existing client.
      }
    }
    return self.clients.openWindow(path);
  })());
});

self.addEventListener("notificationclose", (event) => {
  const diagnosticId = event.notification.data?.diagnosticId;
  const localDiagnosticId = event.notification.data?.localDiagnosticId;
  const receipts = [];
  if (typeof diagnosticId === "string" && GAME_ID_PATTERN.test(diagnosticId)) {
    receipts.push(postPushDiagnosticStage(diagnosticId, "notification_closed"));
  }
  if (typeof localDiagnosticId === "string" && GAME_ID_PATTERN.test(localDiagnosticId)) {
    receipts.push(postPushDiagnosticStage(
      localDiagnosticId,
      "notification_closed",
      LOCAL_PUSH_DIAGNOSTIC_EVENT_TYPE,
    ));
  }
  if (receipts.length > 0) event.waitUntil(Promise.all(receipts));
});
