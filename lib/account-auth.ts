import {
  accountIdSecret,
  appEnvironment,
  sessionSigningSecret,
  turnstileSecretKey,
} from "./runtime";

export interface PlayerAccount {
  id: string;
  displayName: string;
}

export const PLAYER_SESSION_COOKIE = "__Host-chessriot-access";
const SESSION_LIFETIME_SECONDS = 24 * 60 * 60;
const EMAIL_HEADER = "oai-authenticated-user-email";
const NAME_HEADER = "oai-authenticated-user-full-name";
const NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";
const SESSION_VERSION = 1;

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
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    return new TextDecoder().decode(
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

function canonicalEmail(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function configuredSecret(
  configured: string | null,
  localFallback: string,
): string | null {
  if (configured) return configured;
  return appEnvironment() === "local" || appEnvironment() === "test"
    ? localFallback
    : null;
}

export async function accountIdForEmail(email: string): Promise<string | null> {
  const secret = configuredSecret(
    accountIdSecret(),
    "chessriot-local-account-id-secret",
  );
  return secret ? hmac(secret, canonicalEmail(email)) : null;
}

function displayNameFromHeaders(headers: Pick<Headers, "get">, email: string): string {
  const encoded = headers.get(NAME_HEADER);
  if (encoded && headers.get(NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8) {
    try {
      const decoded = decodeURIComponent(encoded).normalize("NFC").trim();
      if (decoded) return Array.from(decoded).slice(0, 24).join("");
    } catch {
      // Fall back to the non-sensitive local part.
    }
  }
  return Array.from(email.split("@")[0] || "Player").slice(0, 24).join("");
}

async function identityFromHeaders(
  headers: Pick<Headers, "get">,
): Promise<PlayerAccount | null> {
  const rawEmail = headers.get(EMAIL_HEADER);
  if (!rawEmail) return null;
  const email = canonicalEmail(rawEmail);
  const id = await accountIdForEmail(email);
  if (!id) return null;
  return { id, displayName: displayNameFromHeaders(headers, email) };
}

function cookieValue(headers: Pick<Headers, "get">, name: string): string | null {
  const cookie = headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [candidate, ...rest] = part.trim().split("=");
    if (candidate === name) return rest.join("=") || null;
  }
  return null;
}

export async function mintPlayerSession(
  account: PlayerAccount,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  const secret = configuredSecret(
    sessionSigningSecret(),
    "chessriot-local-session-signing-secret",
  );
  if (!secret) return null;
  const payload = textToBase64Url(JSON.stringify({
    v: SESSION_VERSION,
    sub: account.id,
    exp: nowSeconds + SESSION_LIFETIME_SECONDS,
  }));
  return `${payload}.${await hmac(secret, payload)}`;
}

export function playerSessionCookie(value: string): string {
  return [
    `${PLAYER_SESSION_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${SESSION_LIFETIME_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export async function verifiedAccountFromHeaders(
  headers: Pick<Headers, "get">,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<PlayerAccount | null> {
  const account = await identityFromHeaders(headers);
  if (!account) return null;
  const token = cookieValue(headers, PLAYER_SESSION_COOKIE);
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const secret = configuredSecret(
    sessionSigningSecret(),
    "chessriot-local-session-signing-secret",
  );
  if (!secret || !constantTimeEqual(await hmac(secret, payload), signature)) {
    return null;
  }
  const decoded = base64UrlToText(payload);
  if (!decoded) return null;
  try {
    const data = JSON.parse(decoded) as { v?: unknown; sub?: unknown; exp?: unknown };
    if (
      data.v !== SESSION_VERSION ||
      data.sub !== account.id ||
      !Number.isInteger(data.exp) ||
      Number(data.exp) <= nowSeconds
    ) return null;
    return account;
  } catch {
    return null;
  }
}

export async function requestIdentity(
  request: Request,
): Promise<PlayerAccount | null> {
  return identityFromHeaders(request.headers);
}

export async function verifiedRequestAccount(
  request: Request,
): Promise<PlayerAccount | null> {
  return verifiedAccountFromHeaders(request.headers);
}

export async function verifyTurnstileToken(
  token: string,
  hostname: string,
  idempotencyKey: string,
): Promise<boolean> {
  if (!token || token.length > 2_048) return false;
  const secret = configuredSecret(
    turnstileSecretKey(),
    "1x0000000000000000000000000000000AA",
  );
  if (!secret) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          secret,
          response: token,
          idempotency_key: idempotencyKey,
        }),
      },
    );
    if (!response.ok) return false;
    const result = await response.json() as {
      success?: unknown;
      hostname?: unknown;
      action?: unknown;
    };
    const testEnvironment =
      appEnvironment() === "local" || appEnvironment() === "test";
    return result.success === true
      && (testEnvironment || result.hostname === hostname)
      && (testEnvironment || result.action === "chessriot_login");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
