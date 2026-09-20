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
export const DEMO_VIDEO_STORY_VERSION = 5;

export const DEMO_VIDEO_NARRATION = `Ron and Omri want chess that fits real life. ChessRiot begins with a clear look at the product before login. To play, Ron signs in with Google. There is no guest mode. He claims one permanent username. If he wants a quick tour, an optional forty-five-second tutorial is waiting in Settings.

His signed-in home is built for action: continue a game, answer a friend request, or see whose turn it is. Solo has five Riot Bot levels. Each skin changes the board, pieces, soundscape, and richer music without losing its identity.

Ron finds Omri by username. After Omri accepts, Ron chooses the variant and pace, then sends a direct challenge. Activity keeps the request, challenge, turns, and result in one inbox.

On the board, live clocks, status, deadline, and essential controls fit one screen. Move by drag, tap, click, or keyboard. Every legal move is checked and saved. Clear capture, great-move, checkmate, and result moments let the game breathe.

Ron closes the browser. Later, both players return to the exact position. When the game ends, either player can share a read-only recap and replay link. History keeps every game. Privacy and Data lets each player download their data, manage blocks, or delete the account after Google verification.

Magic Rules stay Coming Soon for most players, with server-controlled access for invited testers.

Real chess that survives real life. ChessRiot. One game, still moving.`;

export const DEMO_VIDEO_CAPTIONS = `WEBVTT

00:00:00.500 --> 00:00:05.000
Ron and Omri want chess
that fits real life.

00:00:05.000 --> 00:00:09.500
See the product clearly
before login.

00:00:09.500 --> 00:00:14.000
Sign in with Google to play.
There is no guest mode.

00:00:14.000 --> 00:00:19.000
Claim one permanent username.

00:00:19.000 --> 00:00:24.000
An optional 45-second tutorial
waits in Settings.

00:00:24.000 --> 00:00:29.000
Continue games, answer requests,
and see whose turn it is.

00:00:29.000 --> 00:00:33.500
Solo has five Riot Bot levels.

00:00:33.500 --> 00:00:38.500
Every skin keeps its own board,
pieces, effects, and richer music.

00:00:38.500 --> 00:00:43.500
Find friends by username.

00:00:43.500 --> 00:00:48.500
Choose the variant and pace,
then send a direct challenge.

00:00:48.500 --> 00:00:53.500
Activity keeps requests, challenges,
turns, and results together.

00:00:53.500 --> 00:00:59.000
Live clocks, status, deadline,
and controls fit one screen.

00:00:59.000 --> 00:01:03.500
Move by drag, tap, click,
or keyboard.

00:01:03.500 --> 00:01:08.000
Every legal move is checked
and saved.

00:01:08.000 --> 00:01:13.000
Capture, great-move, checkmate,
and result moments can breathe.

00:01:13.000 --> 00:01:17.000
Close the browser.
Nothing is lost.

00:01:17.000 --> 00:01:22.000
Both players return
to the exact position.

00:01:22.000 --> 00:01:26.000
Share a read-only recap and replay.

00:01:26.000 --> 00:01:28.500
Download data, manage blocks,
or delete after Google verification.

00:01:28.500 --> 00:01:29.500
Magic stays gated for invited testers.

00:01:29.500 --> 00:01:29.900
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
        "Warm, playful, story-first narration. Speak clearly at about 150 words per minute with brief pauses between paragraphs. Finish every word within 89 seconds. Let the opening problem feel human and the ending feel earned. Keep the energy grounded, not salesy.",
      response_format: "mp3",
    }),
  });
}

export function demoVideoBucketBinding(): R2Bucket | null {
  return demoVideoBucket();
}
