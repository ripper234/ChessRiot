import type { AiDifficulty, GameMode } from "./game-types";

const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (!name || Array.from(name).length > 24 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

export function isSecret(value: unknown): value is string {
  return typeof value === "string" && SECRET_PATTERN.test(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function isGameMode(value: unknown): value is GameMode {
  return value === "solo" || value === "multiplayer";
}

export function isAiDifficulty(value: unknown): value is AiDifficulty {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function requestIsSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
