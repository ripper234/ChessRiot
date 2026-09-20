import { ensureSchema, getDatabase } from "@/db";
import { hashOpaque } from "./observability";

export async function enforcePublicRateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  const address = request.headers.get("cf-connecting-ip")?.trim();
  if (!address) return { allowed: true, retryAfter: 0 };
  const addressHash = await hashOpaque(`public-rate:${scope}:${address}`);
  if (!addressHash) return { allowed: false, retryAfter: windowSeconds };
  await ensureSchema();
  const now = Math.floor(Date.now() / 1_000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const expiresAt = windowStart + windowSeconds;
  const key = `${scope}:${addressHash}:${windowStart}`;
  const database = getDatabase();
  await database.prepare("DELETE FROM public_rate_limit_windows WHERE expires_at < ?")
    .bind(now)
    .run();
  const row = await database.prepare(`INSERT INTO public_rate_limit_windows (
      key, scope, hit_count, expires_at
    ) VALUES (?, ?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET hit_count = public_rate_limit_windows.hit_count + 1
    RETURNING hit_count`)
    .bind(key, scope, expiresAt)
    .first<{ hit_count: number }>();
  return {
    allowed: Boolean(row && row.hit_count <= limit),
    retryAfter: Math.max(1, expiresAt - now),
  };
}
