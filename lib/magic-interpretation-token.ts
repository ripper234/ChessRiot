import {
  normalizeMagicPrompt,
  validateCompiledMagicRules,
  type CompiledMagicRules,
} from "./magic-rules";
import { accountIdSecret } from "./runtime";

const TOKEN_TTL_MS = 15 * 60 * 1_000;

interface MagicInterpretationPayload {
  accountId: string;
  prompt: string;
  compiled: CompiledMagicRules;
  expiresAt: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signingKey(): Promise<CryptoKey> {
  const secret = accountIdSecret();
  if (!secret) throw new Error("Magic signing secret is unavailable");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createMagicInterpretationToken(
  accountId: string,
  prompt: string,
  compiled: CompiledMagicRules,
): Promise<string> {
  const payload: MagicInterpretationPayload = {
    accountId,
    prompt,
    compiled,
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", await signingKey(), new TextEncoder().encode(encoded)),
  );
  return `${encoded}.${toBase64Url(signature)}`;
}

export async function verifyMagicInterpretationToken(
  token: unknown,
  accountId: string,
  requestedPrompt: unknown,
): Promise<{ prompt: string; compiled: CompiledMagicRules } | null> {
  if (typeof token !== "string" || token.length > 4_000) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const signature = fromBase64Url(parts[1]);
    const signatureBuffer = signature.buffer.slice(
      signature.byteOffset,
      signature.byteOffset + signature.byteLength,
    ) as ArrayBuffer;
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(),
      signatureBuffer,
      new TextEncoder().encode(parts[0]),
    );
    if (!valid) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(parts[0])),
    ) as Partial<MagicInterpretationPayload>;
    const normalized = normalizeMagicPrompt(requestedPrompt);
    if (
      !normalized.ok
      || payload.accountId !== accountId
      || payload.prompt !== normalized.prompt
      || typeof payload.expiresAt !== "number"
      || payload.expiresAt < Date.now()
    ) {
      return null;
    }
    return {
      prompt: payload.prompt,
      compiled: validateCompiledMagicRules(payload.compiled),
    };
  } catch {
    return null;
  }
}
