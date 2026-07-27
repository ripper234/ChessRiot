import { ensureSchema, getDatabase } from "@/db";
import {
  appEnvironment,
  demoVideoBucket,
  openAiApiKey,
  videoRegenSharedSecret,
} from "./runtime";

export const DEMO_VIDEO_DURATION_SECONDS = 90;
export const DEMO_VIDEO_MAX_BYTES = 45 * 1024 * 1024;
export const DEMO_VIDEO_FALLBACK_MEDIA = "/demo-assets/chessriot-demo.mp4";
export const DEMO_VIDEO_TTS_MODEL = "gpt-4o-mini-tts-2025-12-15";
export const DEMO_VIDEO_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const DEMO_VIDEO_STORY_VERSION = 2;

export const DEMO_VIDEO_NARRATION = `Ron and Omri love chess. The problem is finding an hour when both are free. ChessRiot turns spare minutes into a game that keeps moving.

Ron opens the browser, enters his name, and starts. No account. No CAPTCHA. Solo is ready for a warm-up. He chooses one of five Riot Bot levels and moves by drag, tap, click, or keyboard.

But their game should feel like theirs. He opens Themes and transforms the board into Blockfield.

Now the real match. Ron switches to Multiplayer, chooses three days per move, and creates a game. ChessRiot gives him one private invitation for Omri.

It waits safely until Omri is ready. When Omri claims Black, Ron has White, so he moves first. Every move is saved immediately.

Ron closes the browser. Later, each player returns through a private seat link, moves, and leaves. The same saved board and full history are waiting whenever either comes back. Step back, replay the position, then return live.

No scheduling. No setup. Just real chess that survives real life.

ChessRiot. Two people. One game, still moving.`;

export const DEMO_VIDEO_CAPTIONS = `WEBVTT

00:00:00.500 --> 00:00:05.500
Ron and Omri love chess.

00:00:05.500 --> 00:00:10.000
The problem is finding an hour
when both are free.

00:00:10.000 --> 00:00:14.500
ChessRiot turns spare minutes
into a game that keeps moving.

00:00:14.500 --> 00:00:19.000
Ron enters his name and starts.
No account. No CAPTCHA.

00:00:19.000 --> 00:00:24.500
Solo is ready for a warm-up.
Choose one of five Riot Bot levels.

00:00:24.500 --> 00:00:30.000
Move by drag, tap, click,
or keyboard.

00:00:30.000 --> 00:00:34.500
Their game should feel like theirs.

00:00:34.500 --> 00:00:39.000
Open Themes and transform
the board into Blockfield.

00:00:39.000 --> 00:00:44.500
Now the real match.
Switch to Multiplayer.

00:00:44.500 --> 00:00:51.000
Choose three days per move
and create the game.

00:00:51.000 --> 00:00:56.500
ChessRiot creates one private
invitation for Omri.

00:00:56.500 --> 00:01:02.500
It waits safely for Omri.
When he claims Black…

00:01:02.500 --> 00:01:07.000
Ron has White, so he moves first.
Every move is saved.

00:01:07.000 --> 00:01:12.000
Ron closes the browser.
Nothing is lost.

00:01:12.000 --> 00:01:18.000
Each player can return through
a private seat link.

00:01:18.000 --> 00:01:23.500
The same saved board and
full history are waiting.

00:01:23.500 --> 00:01:27.000
Step back, replay,
then return live.

00:01:27.000 --> 00:01:29.000
Real chess that survives real life.

00:01:29.000 --> 00:01:29.900
One game, still moving.
`;

export type DemoVideoAction = "narration" | "publish" | "fail";

export interface DemoVideoManifest {
  version: typeof DEMO_VIDEO_STORY_VERSION;
  jobId: string;
  mediaKey: string;
  captionsKey: string;
  mimeType: string;
  durationSeconds: number;
  sizeBytes: number;
  sha256: string;
  generatedAt: string;
}

interface DemoJobRow {
  status: string;
  requested_at: string;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid_base64url");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function verifyHmac(
  canonical: string,
  signature: string,
  secret: string,
): Promise<boolean> {
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
      new TextEncoder().encode(canonical),
    );
  } catch {
    return false;
  }
}

export function demoVideoCanonicalRequest(
  action: DemoVideoAction,
  jobId: string,
  timestamp: string,
  nonce: string,
  details: string,
): string {
  return ["chessriot-demo-v1", action, jobId, timestamp, nonce, details].join("\n");
}

export async function authorizeDemoVideoRequest(
  request: Request,
  action: DemoVideoAction,
  details: string,
): Promise<{ jobId: string; nonce: string } | null> {
  const secret = videoRegenSharedSecret();
  const jobId = request.headers.get("x-demo-video-job") ?? "";
  const timestamp = request.headers.get("x-demo-video-timestamp") ?? "";
  const nonce = request.headers.get("x-demo-video-nonce") ?? "";
  const signature = request.headers.get("x-demo-video-signature") ?? "";
  if (
    appEnvironment() !== "development"
    || !secret
    || !/^[0-9a-f-]{36}$/i.test(jobId)
    || !/^[0-9a-f-]{36}$/i.test(nonce)
    || !/^\d{13}$/.test(timestamp)
    || !/^[A-Za-z0-9_-]{32,}$/.test(signature)
  ) return null;
  const issuedAt = Number(timestamp);
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 60_000) {
    return null;
  }
  const canonical = demoVideoCanonicalRequest(
    action,
    jobId,
    timestamp,
    nonce,
    details,
  );
  if (!(await verifyHmac(canonical, signature, secret))) return null;
  return { jobId, nonce };
}

export async function claimDemoVideoNonce(
  nonce: string,
  issuedAt: number,
): Promise<boolean> {
  await ensureSchema();
  const db = getDatabase();
  const now = Date.now();
  await db.prepare("DELETE FROM demo_video_nonces WHERE expires_at < ?")
    .bind(now)
    .run();
  try {
    await db.prepare(`INSERT INTO demo_video_nonces (nonce, used_at, expires_at)
      VALUES (?, ?, ?)`)
      .bind(nonce, new Date(now).toISOString(), issuedAt + 5 * 60_000)
      .run();
    return true;
  } catch {
    return false;
  }
}

export async function beginDemoVideoJob(
  jobId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  await ensureSchema();
  const db = getDatabase();
  const now = new Date();
  const nowIso = now.toISOString();
  const activeCutoff = new Date(now.getTime() - 20 * 60_000).toISOString();
  await db.prepare(`UPDATE demo_video_jobs
    SET status = 'failed', error_code = 'generator_timeout'
    WHERE status IN ('narrating', 'rendering', 'publishing') AND requested_at < ?`)
    .bind(activeCutoff)
    .run();
  const lock = await db.prepare(`INSERT INTO demo_video_generation_lock
      (id, job_id, expires_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      job_id = excluded.job_id,
      expires_at = excluded.expires_at
    WHERE demo_video_generation_lock.expires_at < ?`)
    .bind(jobId, now.getTime() + 20 * 60_000, now.getTime())
    .run();
  if ((lock.meta.changes ?? 0) !== 1) {
    return { ok: false, status: 409, error: "generation_in_progress" };
  }
  const releaseLock = async () => {
    await db.prepare(
      "DELETE FROM demo_video_generation_lock WHERE id = 1 AND job_id = ?",
    ).bind(jobId).run();
  };
  const latest = await db.prepare(`SELECT status, requested_at
    FROM demo_video_jobs ORDER BY requested_at DESC LIMIT 1`)
    .first<DemoJobRow>();
  if (
    latest
    && new Date(latest.requested_at).getTime() > now.getTime() - 30 * 60_000
  ) {
    await releaseLock();
    return { ok: false, status: 429, error: "generation_cooldown" };
  }
  const dayStart = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString();
  const [day, month] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS count FROM demo_video_jobs WHERE requested_at >= ?")
      .bind(dayStart)
      .first<{ count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM demo_video_jobs WHERE requested_at >= ?")
      .bind(monthStart)
      .first<{ count: number }>(),
  ]);
  if ((day?.count ?? 0) >= 3 || (month?.count ?? 0) >= 20) {
    await releaseLock();
    return { ok: false, status: 429, error: "generation_budget_reached" };
  }
  try {
    await db.prepare(`INSERT INTO demo_video_jobs (id, status, requested_at)
      VALUES (?, 'narrating', ?)`)
      .bind(jobId, nowIso)
      .run();
  } catch (error) {
    await releaseLock();
    throw error;
  }
  return { ok: true };
}

export async function updateDemoVideoJob(
  jobId: string,
  status: "rendering" | "ready",
  values: {
    durationSeconds?: number;
    sizeBytes?: number;
    mediaKey?: string;
    errorCode?: string;
  } = {},
): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  const expectedStatus = status === "rendering" ? "narrating" : "publishing";
  const result = await getDatabase().prepare(`UPDATE demo_video_jobs
    SET status = ?,
      narration_ready_at = CASE WHEN ? = 'rendering' THEN ? ELSE narration_ready_at END,
      published_at = CASE WHEN ? = 'ready' THEN ? ELSE published_at END,
      duration_seconds = COALESCE(?, duration_seconds),
      size_bytes = COALESCE(?, size_bytes),
      media_key = COALESCE(?, media_key),
      error_code = ?
    WHERE id = ? AND status = ?`)
    .bind(
      status,
      status,
      now,
      status,
      now,
      values.durationSeconds ?? null,
      values.sizeBytes ?? null,
      values.mediaKey ?? null,
      values.errorCode ?? null,
      jobId,
      expectedStatus,
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) {
    throw new Error("demo_video_job_state_conflict");
  }
  if (status === "ready") {
    await getDatabase().prepare(
      "DELETE FROM demo_video_generation_lock WHERE id = 1 AND job_id = ?",
    ).bind(jobId).run();
  }
}

export async function failDemoVideoJob(
  jobId: string,
  errorCode: string,
  includePublishing = false,
): Promise<void> {
  await ensureSchema();
  const db = getDatabase();
  const result = await db.prepare(includePublishing
    ? `UPDATE demo_video_jobs
      SET status = 'failed', error_code = ?
      WHERE id = ? AND status IN ('narrating', 'rendering', 'publishing')`
    : `UPDATE demo_video_jobs
      SET status = 'failed', error_code = ?
      WHERE id = ? AND status IN ('narrating', 'rendering')`)
    .bind(errorCode, jobId)
    .run();
  if ((result.meta.changes ?? 0) !== 1) return;
  await db.prepare(
    "DELETE FROM demo_video_generation_lock WHERE id = 1 AND job_id = ?",
  ).bind(jobId).run();
}

export async function claimDemoVideoPublish(jobId: string): Promise<boolean> {
  await ensureSchema();
  const result = await getDatabase().prepare(`UPDATE demo_video_jobs
    SET status = 'publishing'
    WHERE id = ? AND status = 'rendering'`)
    .bind(jobId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export function decodeDemoVideoDigest(value: string): Uint8Array | null {
  if (!DEMO_VIDEO_SHA256_PATTERN.test(value)) return null;
  try {
    const decoded = decodeBase64Url(value);
    return decoded.byteLength === 32 ? decoded : null;
  } catch {
    return null;
  }
}

export async function latestDemoVideoManifest(): Promise<DemoVideoManifest | null> {
  const bucket = demoVideoBucket();
  if (!bucket) return null;
  const object = await bucket.get("demo-video/latest.json");
  if (!object) return null;
  try {
    const value = await object.json<DemoVideoManifest>();
    return value?.version === DEMO_VIDEO_STORY_VERSION
      && typeof value.mediaKey === "string"
      && typeof value.captionsKey === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

export async function requestDemoVideoNarration(): Promise<Response> {
  const apiKey = openAiApiKey();
  if (!apiKey) {
    return Response.json({ error: "narration_unavailable" }, { status: 503 });
  }
  return fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: DEMO_VIDEO_TTS_MODEL,
      voice: "cedar",
      input: DEMO_VIDEO_NARRATION,
      instructions:
        "Warm, playful, story-first narration. Speak clearly at about 125 words per minute with short pauses between paragraphs. Let the opening problem feel human and the ending feel earned. Keep the energy grounded, not salesy.",
      response_format: "mp3",
    }),
  });
}

export function demoVideoBucketBinding(): R2Bucket | null {
  return demoVideoBucket();
}
