import { createRemoteJWKSet, jwtVerify } from "jose";
import type { PlayerAccount } from "./account-auth";
import {
  accountIdSecret,
  appEnvironment,
  configuredAppOrigin,
  googleClientId,
  googleClientSecret,
  sessionSigningSecret,
} from "./runtime";
import { normalizeDisplayName } from "./validation";

export const GOOGLE_FLOW_COOKIE = "__Host-chessriot-google-flow";
export const GOOGLE_SESSION_COOKIE = "__Host-chessriot-google-session";
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const FLOW_LIFETIME_SECONDS = 10 * 60;
const LEGACY_SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const GOOGLE_SESSION_LIFETIME_SECONDS = 365 * 24 * 60 * 60;
export const GOOGLE_SESSION_REFRESH_INTERVAL_SECONDS = 24 * 60 * 60;
const COOKIE_VALUE_LIMIT = 4_096;
const FLOW_VERSION = 1 as const;
const SESSION_VERSION = 2 as const;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const GOOGLE_ACCOUNT_ID_PATTERN = /^google_[A-Za-z0-9_-]{43}$/;

interface SignedEnvelope {
  v: 1 | 2;
  kind: "google-flow" | "google-session";
  iat: number;
  exp: number;
}

interface GoogleFlow extends SignedEnvelope {
  v: typeof FLOW_VERSION;
  kind: "google-flow";
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

interface GoogleSession extends SignedEnvelope {
  v: typeof SESSION_VERSION;
  kind: "google-session";
  accountId: string;
  displayName: string;
  authenticatedAt: number;
}

interface LegacyGoogleSession extends SignedEnvelope {
  v: 1;
  kind: "google-session";
  accountId: string;
  displayName: string;
}

export interface GoogleOAuthStart {
  authorizationUrl: string;
  flowCookie: string;
}

interface GoogleOAuthConfiguration {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  sessionSecret: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function textToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToText(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function randomToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function cookieValue(headers: Pick<Headers, "get">, name: string): string | null {
  const cookie = headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [candidate, ...rest] = part.trim().split("=");
    if (candidate === name) return rest.join("=") || null;
  }
  return null;
}

function cookie(name: string, value: string, maximumAge: number): string {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maximumAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function clearGoogleFlowCookie(): string {
  return cookie(GOOGLE_FLOW_COOKIE, "", 0);
}

export function clearGoogleSessionCookie(): string {
  return cookie(GOOGLE_SESSION_COOKIE, "", 0);
}

export function safeRelativeReturnPath(value: string | null): string {
  if (!value || value.length > 512 || /[\u0000-\u001f\u007f\\]/.test(value)) {
    return "/app";
  }
  try {
    const base = "https://chessriot.invalid";
    const parsed = new URL(value, base);
    if (parsed.origin !== base) return "/app";
    const privacyCenter = parsed.pathname === "/privacy-center"
      && (!parsed.search || parsed.search === "?delete=1");
    const publicPath = ["/", "/app", "/privacy", "/terms", "/changelog", "/demo", "/privacy-center", "/worlds"]
      .includes(parsed.pathname);
    const worldPath = /^\/worlds\/0x[0-9a-f]{40}$/.test(parsed.pathname);
    const gamePath = /^\/g\/[0-9a-f-]{36}$/i.test(parsed.pathname);
    const invitationPath = /^\/join\/[A-Za-z0-9_-]{32,128}$/.test(parsed.pathname);
    const referralPath = /^\/invite\/[A-Za-z0-9_-]{16}$/.test(parsed.pathname);
    if (privacyCenter && !parsed.hash) return `${parsed.pathname}${parsed.search}`;
    if (publicPath && !parsed.search && !parsed.hash) return parsed.pathname;
    if (worldPath && !parsed.search && !parsed.hash) return parsed.pathname;
    if (invitationPath && !parsed.hash) return parsed.pathname;
    if (referralPath && !parsed.hash) return parsed.pathname;
    if (gamePath && !parsed.hash) return parsed.pathname;
    return "/app";
  } catch {
    return "/app";
  }
}

export function googleCallbackUrl(): string | null {
  const origin = configuredAppOrigin();
  const expectedOrigin = appEnvironment() === "development"
    ? "https://dev.chessriot.gg"
    : appEnvironment() === "production"
      ? "https://chessriot.gg"
      : null;
  return origin && expectedOrigin && origin === expectedOrigin
    ? `${expectedOrigin}${GOOGLE_CALLBACK_PATH}`
    : null;
}

function googleOAuthConfiguration(): GoogleOAuthConfiguration | null {
  const clientId = googleClientId();
  const clientSecret = googleClientSecret();
  const callbackUrl = googleCallbackUrl();
  const sessionSecret = sessionSigningSecret();
  const identitySecret = accountIdSecret();
  if (
    !clientId
    || !clientSecret
    || !callbackUrl
    || !sessionSecret
    || sessionSecret.length < 32
    || !identitySecret
    || identitySecret.length < 32
  ) return null;
  return { clientId, clientSecret, callbackUrl, sessionSecret };
}

export function googleLoginAvailable(): boolean {
  return googleOAuthConfiguration() !== null;
}

async function signEnvelope(
  envelope: GoogleFlow | GoogleSession | LegacyGoogleSession,
  secret: string,
): Promise<string> {
  const payload = textToBase64Url(JSON.stringify(envelope));
  return `${payload}.${await hmac(secret, payload)}`;
}

async function readEnvelope(
  value: string | null,
  expectedKind: SignedEnvelope["kind"],
  nowSeconds: number,
): Promise<GoogleFlow | GoogleSession | LegacyGoogleSession | null> {
  if (!value || value.length > COOKIE_VALUE_LIMIT) return null;
  const [payload, signature, extra] = value.split(".");
  const secret = sessionSigningSecret();
  if (!payload || !signature || extra || !secret || secret.length < 32) return null;
  if (!constantTimeEqual(await hmac(secret, payload), signature)) return null;
  const decoded = base64UrlToText(payload);
  if (!decoded) return null;
  try {
    const envelope = JSON.parse(decoded) as Partial<SignedEnvelope> & Record<string, unknown>;
    const maximumLifetime = expectedKind === "google-flow"
      ? FLOW_LIFETIME_SECONDS
      : envelope.v === 1
        ? LEGACY_SESSION_LIFETIME_SECONDS
        : GOOGLE_SESSION_LIFETIME_SECONDS;
    if (
      (expectedKind === "google-flow" && envelope.v !== FLOW_VERSION)
      || (expectedKind === "google-session" && envelope.v !== 1 && envelope.v !== SESSION_VERSION)
      || envelope.kind !== expectedKind
      || !Number.isSafeInteger(envelope.iat)
      || !Number.isSafeInteger(envelope.exp)
      || Number(envelope.iat) < 0
      || Number(envelope.iat) > nowSeconds + 15
      || Number(envelope.exp) <= Number(envelope.iat)
      || Number(envelope.exp) - Number(envelope.iat) > maximumLifetime
      || Number(envelope.exp) <= nowSeconds
    ) return null;
    if (
      expectedKind === "google-session"
      && envelope.v === SESSION_VERSION
      && (
        !Number.isSafeInteger(envelope.authenticatedAt)
        || Number(envelope.authenticatedAt) < 0
        || Number(envelope.authenticatedAt) > Number(envelope.iat)
      )
    ) return null;
    return envelope as unknown as GoogleFlow | GoogleSession | LegacyGoogleSession;
  } catch {
    return null;
  }
}

export async function createGoogleOAuthStart(
  returnTo: string | null,
  nowSeconds = Math.floor(Date.now() / 1_000),
  reauthenticate = false,
): Promise<GoogleOAuthStart | null> {
  const config = googleOAuthConfiguration();
  if (!config) return null;
  const verifier = randomToken();
  const flow: GoogleFlow = {
    v: FLOW_VERSION,
    kind: "google-flow",
    iat: nowSeconds,
    exp: nowSeconds + FLOW_LIFETIME_SECONDS,
    state: randomToken(),
    nonce: randomToken(),
    verifier,
    returnTo: safeRelativeReturnPath(returnTo),
  };
  const authorization = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  authorization.searchParams.set("client_id", config.clientId);
  authorization.searchParams.set("redirect_uri", config.callbackUrl);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", "openid email profile");
  authorization.searchParams.set("state", flow.state);
  authorization.searchParams.set("nonce", flow.nonce);
  authorization.searchParams.set("code_challenge", await sha256Base64Url(verifier));
  authorization.searchParams.set("code_challenge_method", "S256");
  authorization.searchParams.set("include_granted_scopes", "true");
  if (reauthenticate) {
    authorization.searchParams.set("prompt", "login");
    authorization.searchParams.set("max_age", "0");
  }
  return {
    authorizationUrl: authorization.toString(),
    flowCookie: cookie(
      GOOGLE_FLOW_COOKIE,
      await signEnvelope(flow, config.sessionSecret),
      FLOW_LIFETIME_SECONDS,
    ),
  };
}

export async function googleFlowFromHeaders(
  headers: Pick<Headers, "get">,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<GoogleFlow | null> {
  const envelope = await readEnvelope(
    cookieValue(headers, GOOGLE_FLOW_COOKIE),
    "google-flow",
    nowSeconds,
  );
  if (
    !envelope
    || envelope.kind !== "google-flow"
    || typeof envelope.state !== "string"
    || !TOKEN_PATTERN.test(envelope.state)
    || typeof envelope.nonce !== "string"
    || !TOKEN_PATTERN.test(envelope.nonce)
    || typeof envelope.verifier !== "string"
    || !TOKEN_PATTERN.test(envelope.verifier)
    || typeof envelope.returnTo !== "string"
    || envelope.returnTo !== safeRelativeReturnPath(envelope.returnTo)
  ) return null;
  return envelope;
}

export async function accountIdForGoogleSubject(subject: string): Promise<string | null> {
  const secret = accountIdSecret();
  if (!secret || !subject || subject.length > 255) return null;
  return `google_${await hmac(secret, `google-sub:v1:${subject}`)}`;
}

export async function exchangeGoogleCode(
  code: string,
  flow: GoogleFlow,
): Promise<PlayerAccount | null> {
  const config = googleOAuthConfiguration();
  if (!config || !code || code.length > 4_096) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: flow.verifier,
        grant_type: "authorization_code",
        redirect_uri: config.callbackUrl,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const token = await response.json() as { id_token?: unknown };
    if (typeof token.id_token !== "string" || token.id_token.length > 16_384) return null;
    const { payload } = await jwtVerify(token.id_token, GOOGLE_JWKS, {
      audience: config.clientId,
      issuer: GOOGLE_ISSUERS,
    });
    if (
      payload.nonce !== flow.nonce
      || (payload.azp !== undefined && payload.azp !== config.clientId)
      || typeof payload.sub !== "string"
      || payload.email_verified !== true
      || typeof payload.email !== "string"
      || payload.email.length > 320
    ) return null;
    const accountId = await accountIdForGoogleSubject(payload.sub);
    if (!accountId) return null;
    const displayName = normalizeDisplayName(payload.name)
      ?? normalizeDisplayName(
        typeof payload.email === "string" ? payload.email.split("@")[0] : null,
      )
      ?? "Player";
    return { id: accountId, displayName };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function googleSessionCookie(
  account: PlayerAccount,
  nowSeconds = Math.floor(Date.now() / 1_000),
  authenticatedAt = nowSeconds,
): Promise<string | null> {
  const secret = sessionSigningSecret();
  if (
    !secret
    || secret.length < 32
    || !GOOGLE_ACCOUNT_ID_PATTERN.test(account.id)
    || !Number.isSafeInteger(authenticatedAt)
    || authenticatedAt < 0
    || authenticatedAt > nowSeconds
  ) return null;
  const session: GoogleSession = {
    v: SESSION_VERSION,
    kind: "google-session",
    iat: nowSeconds,
    exp: nowSeconds + GOOGLE_SESSION_LIFETIME_SECONDS,
    accountId: account.id,
    displayName: account.displayName,
    authenticatedAt,
  };
  return cookie(
    GOOGLE_SESSION_COOKIE,
    await signEnvelope(session, secret),
    GOOGLE_SESSION_LIFETIME_SECONDS,
  );
}

export async function googleSessionAccountFromHeaders(
  headers: Pick<Headers, "get">,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<PlayerAccount | null> {
  return (await googleSessionDetailsFromHeaders(headers, nowSeconds))?.account ?? null;
}

export async function googleSessionDetailsFromHeaders(
  headers: Pick<Headers, "get">,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<{
  account: PlayerAccount;
  authenticatedAt: number;
  issuedAt: number;
  version: 1 | 2;
} | null> {
  const envelope = await readEnvelope(
    cookieValue(headers, GOOGLE_SESSION_COOKIE),
    "google-session",
    nowSeconds,
  );
  if (
    !envelope
    || envelope.kind !== "google-session"
    || typeof envelope.accountId !== "string"
    || !GOOGLE_ACCOUNT_ID_PATTERN.test(envelope.accountId)
  ) return null;
  const displayName = normalizeDisplayName(envelope.displayName);
  return displayName
      ? {
        account: { id: envelope.accountId, displayName },
        authenticatedAt: envelope.v === SESSION_VERSION
          ? (envelope as GoogleSession).authenticatedAt
          : envelope.iat,
        issuedAt: envelope.iat,
        version: envelope.v,
      }
    : null;
}

/**
 * Upgrades legacy sessions immediately and renews active v2 sessions at most
 * once per day. The immutable authenticatedAt value keeps sensitive recent-
 * Google checks independent from ordinary sliding-session activity.
 */
export async function refreshedGoogleSessionCookieFromHeaders(
  headers: Pick<Headers, "get">,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<string | null> {
  const details = await googleSessionDetailsFromHeaders(headers, nowSeconds);
  if (!details) return null;
  if (
    details.version === SESSION_VERSION
    && nowSeconds - details.issuedAt < GOOGLE_SESSION_REFRESH_INTERVAL_SECONDS
  ) return null;
  return googleSessionCookie(
    details.account,
    nowSeconds,
    details.authenticatedAt,
  );
}
