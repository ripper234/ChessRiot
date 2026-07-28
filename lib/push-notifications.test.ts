import { afterEach, describe, expect, it } from "vitest";
import {
  isAllowedPushEndpoint,
  isPushEndpointHash,
  parsePushSubscription,
  publicPushConfig,
} from "./push-notifications";

const p256dh = "A".repeat(87);
const auth = "B".repeat(22);

function base64Url(bytes: ArrayBuffer): string {
  const binary = Array.from(new Uint8Array(bytes))
    .map((byte) => String.fromCharCode(byte))
    .join("");
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function vapidPair(): Promise<{ publicKey: string; privateJwk: JsonWebKey }> {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const [publicKey, privateJwk] = await Promise.all([
    crypto.subtle.exportKey("raw", keys.publicKey).then(base64Url),
    crypto.subtle.exportKey("jwk", keys.privateKey),
  ]);
  return { publicKey, privateJwk };
}

afterEach(() => {
  globalThis.__CHESSRIOT_VAPID_PUBLIC_KEY__ = undefined;
  globalThis.__CHESSRIOT_VAPID_PRIVATE_JWK__ = undefined;
  globalThis.__CHESSRIOT_VAPID_SUBJECT__ = undefined;
});

describe("push subscription validation", () => {
  it("accepts only known browser push-service origins", () => {
    expect(isAllowedPushEndpoint(
      "https://fcm.googleapis.com/fcm/send/device-capability",
    )).toBe(true);
    expect(isAllowedPushEndpoint(
      "https://updates.push.services.mozilla.com/wpush/v2/device-capability",
    )).toBe(true);
    expect(isAllowedPushEndpoint(
      "https://web.push.apple.com/QAA/device-capability",
    )).toBe(true);
    expect(isAllowedPushEndpoint(
      "https://wns2-db5p.notify.windows.com/w/?token=device-capability",
    )).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/device")).toBe(false);
    expect(isAllowedPushEndpoint("https://example.com/device")).toBe(false);
    expect(isAllowedPushEndpoint("https://user@example.com/device")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/device")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/device#fragment")).toBe(false);
    expect(isPushEndpointHash("a".repeat(64))).toBe(true);
    expect(isPushEndpointHash("A".repeat(64))).toBe(false);
    expect(isPushEndpointHash("a".repeat(63))).toBe(false);
  });

  it("normalizes a complete browser subscription", () => {
    expect(parsePushSubscription({
      endpoint: "https://fcm.googleapis.com/fcm/send/device-capability",
      expirationTime: null,
      keys: { p256dh, auth },
    })).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/device-capability",
      expirationTime: null,
      keys: { p256dh, auth },
    });
  });

  it("rejects incomplete keys and invalid expiration values", () => {
    expect(parsePushSubscription({
      endpoint: "https://fcm.googleapis.com/fcm/send/device-capability",
      keys: { p256dh: "short", auth },
    })).toBeNull();
    expect(parsePushSubscription({
      endpoint: "https://fcm.googleapis.com/fcm/send/device-capability",
      expirationTime: -1,
      keys: { p256dh, auth },
    })).toBeNull();
  });
});

describe("push runtime configuration", () => {
  it("stays disabled unless the complete VAPID key pair is present", async () => {
    await expect(publicPushConfig())
      .resolves.toEqual({ enabled: false, publicKey: null });
    globalThis.__CHESSRIOT_VAPID_PUBLIC_KEY__ = "C".repeat(87);
    await expect(publicPushConfig())
      .resolves.toEqual({ enabled: false, publicKey: null });
  });

  it("exposes only a cryptographically matching public VAPID key", async () => {
    const { publicKey, privateJwk } = await vapidPair();
    globalThis.__CHESSRIOT_VAPID_PUBLIC_KEY__ = publicKey;
    globalThis.__CHESSRIOT_VAPID_PRIVATE_JWK__ = JSON.stringify(privateJwk);
    globalThis.__CHESSRIOT_VAPID_SUBJECT__ = "https://chessriot.ripper234.chatgpt.site";
    await expect(publicPushConfig())
      .resolves.toEqual({ enabled: true, publicKey });
  });

  it("rejects a mismatched public/private key pair and malformed subject", async () => {
    const first = await vapidPair();
    const second = await vapidPair();
    globalThis.__CHESSRIOT_VAPID_PUBLIC_KEY__ = second.publicKey;
    globalThis.__CHESSRIOT_VAPID_PRIVATE_JWK__ = JSON.stringify(first.privateJwk);
    globalThis.__CHESSRIOT_VAPID_SUBJECT__ = "https://chessriot.ripper234.chatgpt.site";
    await expect(publicPushConfig())
      .resolves.toEqual({ enabled: false, publicKey: null });

    globalThis.__CHESSRIOT_VAPID_PUBLIC_KEY__ = first.publicKey;
    globalThis.__CHESSRIOT_VAPID_SUBJECT__ = "https://";
    await expect(publicPushConfig())
      .resolves.toEqual({ enabled: false, publicKey: null });
  });
});
