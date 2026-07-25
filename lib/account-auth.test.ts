import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountIdForEmail,
  mintPlayerSession,
  PLAYER_SESSION_COOKIE,
  verifyTurnstileToken,
  verifiedAccountFromHeaders,
} from "./account-auth";

const EMAIL_HEADER = "oai-authenticated-user-email";
const NAME_HEADER = "oai-authenticated-user-full-name";
const NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";

function identityHeaders(email = "player@example.com"): Headers {
  return new Headers({
    [EMAIL_HEADER]: email,
    [NAME_HEADER]: encodeURIComponent("Chess Player"),
    [NAME_ENCODING_HEADER]: "percent-encoded-utf-8",
  });
}

describe("verified account sessions", () => {
  beforeEach(() => {
    globalThis.__CHESSRIOT_ENV__ = "test";
    globalThis.__CHESSRIOT_ACCOUNT_ID_SECRET__ = "account-test-secret";
    globalThis.__CHESSRIOT_SESSION_SIGNING_SECRET__ = "session-test-secret";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("binds a signed session to the authenticated account", async () => {
    const id = await accountIdForEmail("PLAYER@example.com");
    expect(id).toBeTruthy();
    const session = await mintPlayerSession(
      { id: id!, displayName: "Chess Player" },
      1_000,
    );
    const headers = identityHeaders();
    headers.set("cookie", `${PLAYER_SESSION_COOKIE}=${session}`);

    await expect(verifiedAccountFromHeaders(headers, 1_001)).resolves.toEqual({
      id,
      displayName: "Chess Player",
    });
  });

  it("rejects a missing, expired, or account-swapped session", async () => {
    const id = await accountIdForEmail("player@example.com");
    const session = await mintPlayerSession(
      { id: id!, displayName: "Chess Player" },
      1_000,
    );

    await expect(
      verifiedAccountFromHeaders(identityHeaders(), 1_001),
    ).resolves.toBeNull();

    const expired = identityHeaders();
    expired.set("cookie", `${PLAYER_SESSION_COOKIE}=${session}`);
    await expect(
      verifiedAccountFromHeaders(expired, 1_000 + 24 * 60 * 60),
    ).resolves.toBeNull();

    const swapped = identityHeaders("other@example.com");
    swapped.set("cookie", `${PLAYER_SESSION_COOKIE}=${session}`);
    await expect(
      verifiedAccountFromHeaders(swapped, 1_001),
    ).resolves.toBeNull();
  });

  it("accepts a CAPTCHA only after server-side verification", async () => {
    globalThis.__CHESSRIOT_ENV__ = "development";
    globalThis.__CHESSRIOT_TURNSTILE_SECRET_KEY__ = "turnstile-test-secret";
    const verification = vi.fn(async (_url: string, init: RequestInit) => {
      const submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(submitted).toMatchObject({
        secret: "turnstile-test-secret",
        response: "verified-token",
        idempotency_key: "captcha-request-id",
      });
      expect(submitted).not.toHaveProperty("remoteip");
      return Response.json({
        success: true,
        hostname: "chessriot-dev.example",
        action: "chessriot_login",
      });
    });
    vi.stubGlobal("fetch", verification);

    await expect(verifyTurnstileToken(
      "verified-token",
      "chessriot-dev.example",
      "captcha-request-id",
    )).resolves.toBe(true);
    expect(verification).toHaveBeenCalledOnce();
  });

  it("rejects a CAPTCHA with the wrong action", async () => {
    globalThis.__CHESSRIOT_ENV__ = "development";
    globalThis.__CHESSRIOT_TURNSTILE_SECRET_KEY__ = "turnstile-test-secret";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      success: true,
      hostname: "chessriot-dev.example",
      action: "different_action",
    })));

    await expect(verifyTurnstileToken(
      "verified-token",
      "chessriot-dev.example",
      "captcha-request-id",
    )).resolves.toBe(false);
  });
});
