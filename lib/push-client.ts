export interface BrowserPushPayload {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export const PUSH_CONSENT_CACHE = "chessriot-push-consent-v1";
export const PUSH_CONSENT_PATH = "/__chessriot_push_consent__";
export const PUSH_CONSENT_DESIRED_KEY = "chessriot:push-consent-desired:v2";

interface PushConsentSnapshot {
  token: string;
  enabled: boolean;
  username: string | null;
}

const PUSH_CONSENT_WRITE_WAIT_MS = 1_500;
let desiredPushConsent: PushConsentSnapshot = {
  token: "initial",
  enabled: false,
  username: null,
};

function storedDesiredPushConsent(): PushConsentSnapshot {
  if (typeof localStorage === "undefined") return desiredPushConsent;
  try {
    const parsed = JSON.parse(localStorage.getItem(PUSH_CONSENT_DESIRED_KEY) ?? "null");
    if (
      parsed
      && typeof parsed.token === "string"
      && typeof parsed.enabled === "boolean"
      && (parsed.username === null || typeof parsed.username === "string")
    ) return parsed;
  } catch {
    // Use this page's last desired state when storage is unavailable.
  }
  return desiredPushConsent;
}

function storeDesiredPushConsent(snapshot: PushConsentSnapshot): void {
  desiredPushConsent = snapshot;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PUSH_CONSENT_DESIRED_KEY, JSON.stringify(snapshot));
  } catch {
    // Cache Storage still provides best-effort service-worker consent.
  }
}

async function writePushConsent(snapshot: PushConsentSnapshot): Promise<void> {
  const cache = await caches.open(PUSH_CONSENT_CACHE);
  if (snapshot.enabled && snapshot.username) {
    await cache.put(PUSH_CONSENT_PATH, new Response(JSON.stringify({
      version: 2,
      token: snapshot.token,
      username: snapshot.username,
    }), {
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
    }));
  } else {
    await cache.delete(PUSH_CONSENT_PATH);
  }
}

async function persistPushConsent(snapshot: PushConsentSnapshot): Promise<void> {
  try {
    await writePushConsent(snapshot);
  } catch {
    // Page-open reconciliation remains the fallback when Cache Storage is unavailable.
  }
  const latest = storedDesiredPushConsent();
  if (latest.token !== snapshot.token) await persistPushConsent(latest);
}

export function setPushConsentEnabled(enabled: true, expectedUsername: string): Promise<void>;
export function setPushConsentEnabled(enabled: false, expectedUsername?: never): Promise<void>;
export async function setPushConsentEnabled(
  enabled: boolean,
  expectedUsername?: string,
): Promise<void> {
  const snapshot: PushConsentSnapshot = {
    token: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`,
    enabled,
    username: enabled ? expectedUsername ?? null : null,
  };
  storeDesiredPushConsent(snapshot);
  const operation = persistPushConsent(snapshot);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    operation,
    new Promise<void>((resolve) => {
      timer = globalThis.setTimeout(resolve, PUSH_CONSENT_WRITE_WAIT_MS);
    }),
  ]);
  if (timer !== undefined) globalThis.clearTimeout(timer);
}

export function applicationServerKeyBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const decoded = atob(padded);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

export function subscriptionUsesApplicationServerKey(
  subscription: PushSubscription,
  publicKey: string,
): boolean {
  const subscribedKey = subscription.options.applicationServerKey;
  if (!subscribedKey) return false;
  const expectedKey = applicationServerKeyBytes(publicKey);
  const actualKey = new Uint8Array(subscribedKey);
  return actualKey.length === expectedKey.length
    && actualKey.every((byte, index) => byte === expectedKey[index]);
}

export function browserPushPayload(
  subscription: PushSubscription,
): BrowserPushPayload | null {
  const serialized = subscription.toJSON();
  const p256dh = serialized.keys?.p256dh;
  const auth = serialized.keys?.auth;
  if (
    typeof serialized.endpoint !== "string"
    || typeof p256dh !== "string"
    || typeof auth !== "string"
  ) {
    return null;
  }
  return {
    endpoint: serialized.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { p256dh, auth },
  };
}

export async function pushEndpointHash(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(endpoint),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
