export interface BrowserPushPayload {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
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
