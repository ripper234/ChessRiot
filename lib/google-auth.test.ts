import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifiedAccountFromHeaders } from "./account-auth";
import { POST as signOut } from "../app/api/auth/signout/route";
import {
  accountIdForGoogleSubject,
  createGoogleOAuthStart,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_FLOW_COOKIE,
  GOOGLE_SESSION_LIFETIME_SECONDS,
  GOOGLE_SESSION_COOKIE,
  googleCallbackUrl,
  googleFlowFromHeaders,
  googleSessionAccountFromHeaders,
  googleSessionCookie,
  googleSessionDetailsFromHeaders,
  refreshedGoogleSessionCookieFromHeaders,
  exchangeGoogleCode,
  safeRelativeReturnPath,
} from "./google-auth";

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0];
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function signedTestEnvelope(envelope: object): Promise<string> {
  const payload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(envelope)),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("s".repeat(32)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

function resetRuntime(): void {
  globalThis.__CHESSRIOT_ENV__ = undefined;
  globalThis.__CHESSRIOT_APP_ORIGIN__ = undefined;
  globalThis.__CHESSRIOT_ACCOUNT_ID_SECRET__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_ID_DEV__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_ID_PROD__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_SECRET_DEV__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_SECRET_PROD__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_AUTH_SESSION_SECRET_DEV__ = undefined;
  globalThis.__CHESSRIOT_GOOGLE_AUTH_SESSION_SECRET_PROD__ = undefined;
}

describe("Google OAuth", () => {
  beforeEach(() => {
    globalThis.__CHESSRIOT_ENV__ = "development";
    globalThis.__CHESSRIOT_APP_ORIGIN__ = "https://dev.chessriot.gg";
    globalThis.__CHESSRIOT_ACCOUNT_ID_SECRET__ = "a".repeat(32);
    globalThis.__CHESSRIOT_GOOGLE_CLIENT_ID_DEV__ = "dev-client.apps.googleusercontent.com";
    globalThis.__CHESSRIOT_GOOGLE_CLIENT_SECRET_DEV__ = "dev-client-secret";
    globalThis.__CHESSRIOT_GOOGLE_AUTH_SESSION_SECRET_DEV__ = "s".repeat(32);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntime();
  });

  it("uses exact environment callbacks with state, nonce and PKCE", async () => {
    expect(googleCallbackUrl()).toBe(
      `https://dev.chessriot.gg${GOOGLE_CALLBACK_PATH}`,
    );
    const start = await createGoogleOAuthStart("/g/11111111-1111-4111-8111-111111111111");
    expect(start).not.toBeNull();
    const authorization = new URL(start!.authorizationUrl);
    expect(authorization.origin).toBe("https://accounts.google.com");
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      `https://dev.chessriot.gg${GOOGLE_CALLBACK_PATH}`,
    );
    expect(authorization.searchParams.get("scope")).toBe("openid email profile");
    expect(authorization.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(start!.flowCookie).toContain(`${GOOGLE_FLOW_COOKIE}=`);
    expect(start!.flowCookie).toContain("HttpOnly");
    expect(start!.flowCookie).toContain("Secure");
    expect(start!.flowCookie).toContain("SameSite=Lax");
    const reauth = await createGoogleOAuthStart("/privacy-center?delete=1", undefined, true);
    const reauthUrl = new URL(reauth!.authorizationUrl);
    expect(reauthUrl.searchParams.get("prompt")).toBe("login");
    expect(reauthUrl.searchParams.get("max_age")).toBe("0");

    globalThis.__CHESSRIOT_ENV__ = "production";
    globalThis.__CHESSRIOT_APP_ORIGIN__ = "https://chessriot.gg";
    globalThis.__CHESSRIOT_GOOGLE_CLIENT_ID_PROD__ = "prod-client.apps.googleusercontent.com";
    globalThis.__CHESSRIOT_GOOGLE_CLIENT_SECRET_PROD__ = "prod-client-secret";
    globalThis.__CHESSRIOT_GOOGLE_AUTH_SESSION_SECRET_PROD__ = "p".repeat(32);
    expect(googleCallbackUrl()).toBe(
      `https://chessriot.gg${GOOGLE_CALLBACK_PATH}`,
    );
  });

  it("accepts only signed, fresh OAuth state and safe return paths", async () => {
    expect(safeRelativeReturnPath("https://evil.example/app")).toBe("/app");
    const invite = "I".repeat(43);
    const referral = "R".repeat(16);
    const seat = "S".repeat(43);
    expect(safeRelativeReturnPath(`/join/${invite}`)).toBe(`/join/${invite}`);
    expect(safeRelativeReturnPath(`/invite/${referral}`)).toBe(`/invite/${referral}`);
    expect(safeRelativeReturnPath("/privacy-center?delete=1"))
      .toBe("/privacy-center?delete=1");
    expect(safeRelativeReturnPath("/privacy-center?unexpected=1")).toBe("/app");
    expect(safeRelativeReturnPath("/worlds")).toBe("/worlds");
    expect(safeRelativeReturnPath(`/worlds/0x${"a".repeat(40)}`))
      .toBe(`/worlds/0x${"a".repeat(40)}`);
    expect(safeRelativeReturnPath(`/worlds/0x${"A".repeat(40)}`)).toBe("/app");
    expect(safeRelativeReturnPath(`/g/11111111-1111-4111-8111-111111111111#seat=${seat}`))
      .toBe("/app");
    expect(safeRelativeReturnPath("/g/11111111-1111-4111-8111-111111111111#seat=short"))
      .toBe("/app");
    const start = await createGoogleOAuthStart("/privacy", 1_000);
    const headers = new Headers({ cookie: cookiePair(start!.flowCookie) });
    await expect(googleFlowFromHeaders(headers, 1_001)).resolves.toMatchObject({
      returnTo: "/privacy",
    });
    await expect(googleFlowFromHeaders(headers, 1_601)).resolves.toBeNull();
    headers.set(
      "cookie",
      cookiePair(start!.flowCookie).replace(/.$/, (last) => last === "A" ? "B" : "A"),
    );
    await expect(googleFlowFromHeaders(headers, 1_001)).resolves.toBeNull();

    const flow = (await googleFlowFromHeaders(
      new Headers({ cookie: cookiePair(start!.flowCookie) }),
      1_001,
    ))!;
    const invalidFlows = [
      { ...flow, exp: flow.iat + 601 },
      { ...flow, state: "short" },
      { ...flow, nonce: "!".repeat(43) },
      { ...flow, verifier: "a".repeat(42) },
      { ...flow, returnTo: "https://evil.example/app" },
      { ...flow, returnTo: "/privacy?unexpected=query" },
    ];
    for (const invalidFlow of invalidFlows) {
      headers.set(
        "cookie",
        `${GOOGLE_FLOW_COOKIE}=${await signedTestEnvelope(invalidFlow)}`,
      );
      await expect(googleFlowFromHeaders(headers, 1_001)).resolves.toBeNull();
    }
  });

  it("creates a pseudonymous, signed Google session", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const account = {
      id: (await accountIdForGoogleSubject("google-subject"))!,
      displayName: "Chess Player",
    };
    expect(account.id).toMatch(/^google_[A-Za-z0-9_-]{43}$/);
    const setCookie = await googleSessionCookie(account, now);
    expect(setCookie).toContain(`${GOOGLE_SESSION_COOKIE}=`);
    const headers = new Headers({ cookie: cookiePair(setCookie!) });
    await expect(googleSessionAccountFromHeaders(headers, now + 1)).resolves.toEqual(account);
    headers.set("oai-authenticated-user-email", "different@example.com");
    await expect(verifiedAccountFromHeaders(headers)).resolves.toEqual(account);
    expect(setCookie).toContain(`Max-Age=${GOOGLE_SESSION_LIFETIME_SECONDS}`);
    await expect(
      googleSessionAccountFromHeaders(headers, now + GOOGLE_SESSION_LIFETIME_SECONDS - 1),
    ).resolves.toEqual(account);
    await expect(
      googleSessionAccountFromHeaders(headers, now + GOOGLE_SESSION_LIFETIME_SECONDS),
    ).resolves.toBeNull();

    await expect(googleSessionCookie({
      id: "google_not-a-complete-account-id",
      displayName: "Chess Player",
    }, now)).resolves.toBeNull();
    const invalidSessions = [
      {
        v: 1,
        kind: "google-session",
        iat: now,
        exp: now + 30 * 24 * 60 * 60 + 1,
        accountId: account.id,
        displayName: account.displayName,
      },
      {
        v: 1,
        kind: "google-session",
        iat: now,
        exp: now + 60,
        accountId: "google_not-a-complete-account-id",
        displayName: account.displayName,
      },
      {
        v: 2,
        kind: "google-session",
        authenticatedAt: "not-a-timestamp",
        iat: now,
        exp: now + GOOGLE_SESSION_LIFETIME_SECONDS,
        accountId: account.id,
        displayName: account.displayName,
      },
      {
        v: 2,
        kind: "google-session",
        authenticatedAt: now + 1,
        iat: now,
        exp: now + GOOGLE_SESSION_LIFETIME_SECONDS,
        accountId: account.id,
        displayName: account.displayName,
      },
      {
        v: 2,
        kind: "google-session",
        authenticatedAt: now,
        iat: now,
        exp: now + GOOGLE_SESSION_LIFETIME_SECONDS + 1,
        accountId: account.id,
        displayName: account.displayName,
      },
      {
        v: 2,
        kind: "google-session",
        authenticatedAt: now - 120,
        iat: now - 120,
        exp: now,
        accountId: account.id,
        displayName: account.displayName,
      },
    ];
    for (const invalidSession of invalidSessions) {
      headers.set(
        "cookie",
        `${GOOGLE_SESSION_COOKIE}=${await signedTestEnvelope(invalidSession)}`,
      );
      await expect(googleSessionAccountFromHeaders(headers, now + 1)).resolves.toBeNull();
    }
  });

  it("renews activity without making Google authentication recent again", async () => {
    const authenticatedAt = 10_000;
    const account = {
      id: (await accountIdForGoogleSubject("sliding-google-subject"))!,
      displayName: "Sliding Player",
    };
    const original = await googleSessionCookie(account, authenticatedAt, authenticatedAt);
    const headers = new Headers({ cookie: cookiePair(original!) });
    await expect(
      refreshedGoogleSessionCookieFromHeaders(headers, authenticatedAt + 60),
    ).resolves.toBeNull();
    const renewed = await refreshedGoogleSessionCookieFromHeaders(
      headers,
      authenticatedAt + 24 * 60 * 60,
    );
    expect(renewed).not.toBeNull();
    const renewedHeaders = new Headers({ cookie: cookiePair(renewed!) });
    await expect(
      googleSessionDetailsFromHeaders(renewedHeaders, authenticatedAt + 24 * 60 * 60),
    ).resolves.toMatchObject({
      account,
      authenticatedAt,
      issuedAt: authenticatedAt + 24 * 60 * 60,
      version: 2,
    });
  });

  it("upgrades a valid legacy 30-day session on first activity", async () => {
    const now = 20_000;
    const account = {
      id: (await accountIdForGoogleSubject("legacy-google-subject"))!,
      displayName: "Legacy Player",
    };
    const legacy = await signedTestEnvelope({
      v: 1,
      kind: "google-session",
      iat: now,
      exp: now + 30 * 24 * 60 * 60,
      accountId: account.id,
      displayName: account.displayName,
    });
    const renewed = await refreshedGoogleSessionCookieFromHeaders(
      new Headers({ cookie: `${GOOGLE_SESSION_COOKIE}=${legacy}` }),
      now + 1,
    );
    expect(renewed).toContain(`Max-Age=${GOOGLE_SESSION_LIFETIME_SECONDS}`);
    const details = await googleSessionDetailsFromHeaders(
      new Headers({ cookie: cookiePair(renewed!) }),
      now + 1,
    );
    expect(details).toMatchObject({
      account,
      authenticatedAt: now,
      issuedAt: now + 1,
      version: 2,
    });
  });

  it("validates the Google ID token before deriving a stable account", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const publicJwk = await exportJWK(publicKey);
    const now = Math.floor(Date.now() / 1_000);
    const flow = (await googleFlowFromHeaders(
      new Headers({
        cookie: cookiePair((await createGoogleOAuthStart("/app", now))!.flowCookie),
      }),
      now,
    ))!;
    const token = async (nonce: string, verified = true, azp?: string) => new SignJWT({
      nonce,
      email: "player@example.com",
      email_verified: verified,
      name: "Chess Player",
      ...(azp === undefined ? {} : { azp }),
    })
      .setProtectedHeader({ alg: "RS256", kid: "google-test-key" })
      .setIssuer("https://accounts.google.com")
      .setAudience("dev-client.apps.googleusercontent.com")
      .setSubject("stable-google-subject")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(privateKey);
    let idToken = await token(flow.nonce);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (url.hostname === "oauth2.googleapis.com") {
        return Response.json({ id_token: idToken });
      }
      if (url.hostname === "www.googleapis.com") {
        return Response.json({ keys: [{ ...publicJwk, kid: "google-test-key", use: "sig", alg: "RS256" }] });
      }
      return new Response(null, { status: 404 });
    }));

    const expectedId = await accountIdForGoogleSubject("stable-google-subject");
    await expect(exchangeGoogleCode("authorization-code", flow)).resolves.toEqual({
      id: expectedId,
      displayName: "Chess Player",
    });

    idToken = await token("wrong-nonce");
    await expect(exchangeGoogleCode("authorization-code", flow)).resolves.toBeNull();
    idToken = await token(flow.nonce, false);
    await expect(exchangeGoogleCode("authorization-code", flow)).resolves.toBeNull();
    idToken = await token(flow.nonce, true, "different-client.apps.googleusercontent.com");
    await expect(exchangeGoogleCode("authorization-code", flow)).resolves.toBeNull();
    idToken = await token(flow.nonce, true, "dev-client.apps.googleusercontent.com");
    await expect(exchangeGoogleCode("authorization-code", flow)).resolves.toMatchObject({
      id: expectedId,
    });
  });

  it("clears both transient and session cookies on sign out", async () => {
    const response = await signOut(new Request(
      "https://dev.chessriot.gg/api/auth/signout",
      {
        method: "POST",
        headers: { origin: "https://dev.chessriot.gg" },
      },
    ));
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${GOOGLE_FLOW_COOKIE}=`);
    expect(setCookie).toContain(`${GOOGLE_SESSION_COOKIE}=`);
    expect(setCookie.match(/Max-Age=0/g)).toHaveLength(2);
  });
});
