import {
  accountIdSecret,
  appEnvironment,
} from "./runtime";
import { googleSessionAccountFromHeaders } from "./google-auth";

export interface PlayerAccount {
  id: string;
  displayName: string;
}

const EMAIL_HEADER = "oai-authenticated-user-email";
const NAME_HEADER = "oai-authenticated-user-full-name";
const NAME_ENCODING_HEADER = "oai-authenticated-user-full-name-encoding";
const PERCENT_ENCODED_UTF8 = "percent-encoded-utf-8";

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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

export async function guestAccountForToken(
  token: string,
  displayName: string,
): Promise<PlayerAccount> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`chessriot-guest:${token}`),
  );
  return {
    id: `guest_${bytesToBase64Url(new Uint8Array(digest))}`,
    displayName,
  };
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

export async function hostingIdentityFromHeaders(
  headers: Pick<Headers, "get">,
): Promise<PlayerAccount | null> {
  const rawEmail = headers.get(EMAIL_HEADER);
  if (!rawEmail) return null;
  const email = canonicalEmail(rawEmail);
  const id = await accountIdForEmail(email);
  if (!id) return null;
  return { id, displayName: displayNameFromHeaders(headers, email) };
}

export async function verifiedAccountsFromHeaders(
  headers: Pick<Headers, "get">,
): Promise<PlayerAccount[]> {
  const [google, hosting] = await Promise.all([
    googleSessionAccountFromHeaders(headers),
    hostingIdentityFromHeaders(headers),
  ]);
  const accounts: PlayerAccount[] = [];
  if (google) accounts.push(google);
  if (hosting && hosting.id !== google?.id) accounts.push(hosting);
  return accounts;
}

export async function verifiedAccountFromHeaders(
  headers: Pick<Headers, "get">,
): Promise<PlayerAccount | null> {
  return (await verifiedAccountsFromHeaders(headers))[0] ?? null;
}

export async function verifiedRequestAccount(
  request: Request,
): Promise<PlayerAccount | null> {
  return verifiedAccountFromHeaders(request.headers);
}
