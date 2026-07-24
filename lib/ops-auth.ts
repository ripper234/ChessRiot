import { appEnvironment, controlOrigin, opsReadSecret } from "./runtime";

interface ReadGrant {
  v: 1;
  aud: string;
  scope: "observability:read";
  iat: number;
  exp: number;
  nonce: string;
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  const decoded = atob(base64);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(signature) as BufferSource,
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

export function opsCorsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  if (origin === controlOrigin()) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
  }
  return headers;
}

export async function authorizeOpsRead(request: Request): Promise<boolean> {
  const origin = request.headers.get("origin");
  const secret = opsReadSecret();
  if (!secret || origin !== controlOrigin()) return false;
  const contentType = request.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "text/plain") return false;
  const token = (await request.text()).trim();
  if (token.length > 2_000) return false;
  const [payloadPart, signaturePart, extra] = token.split(".");
  if (!payloadPart || !signaturePart || extra) return false;
  if (!(await verifySignature(payloadPart, signaturePart, secret))) return false;
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(payloadPart)),
    ) as Partial<ReadGrant>;
    const now = Math.floor(Date.now() / 1_000);
    return payload.v === 1
      && payload.aud === appEnvironment()
      && payload.scope === "observability:read"
      && typeof payload.iat === "number"
      && typeof payload.exp === "number"
      && payload.iat <= now + 15
      && payload.exp > now
      && payload.exp - payload.iat <= 180
      && typeof payload.nonce === "string"
      && payload.nonce.length >= 16;
  } catch {
    return false;
  }
}
