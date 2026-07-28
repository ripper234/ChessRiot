import {
  generateRequestDetails,
  type PushSubscription,
} from "web-push-neo";
import { ensureSchema, getDatabase } from "@/db";
import type { Color } from "./game-types";
import { recordEvent } from "./observability";
import {
  vapidPrivateJwk,
  vapidPublicKey,
  vapidSubject,
} from "./runtime";

const MAX_SUBSCRIPTIONS_PER_SEAT = 6;
const PUSH_TIMEOUT_MS = 5_000;
const PUSH_ENDPOINT_MAX_LENGTH = 2_048;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

interface StoredPushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: number | null;
}

export interface PushSubscriptionInput {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushRuntimeConfig {
  publicKey: string;
  privateJwk: JsonWebKey;
  subject: string;
}

interface TurnNotificationGame {
  id: string;
  mode: "solo" | "multiplayer";
  status: "waiting" | "active" | "completed";
  version: number;
  turn: Color;
  you: { color: Color };
}

function validBase64Url(value: unknown, min: number, max: number): value is string {
  return (
    typeof value === "string"
    && value.length >= min
    && value.length <= max
    && BASE64URL.test(value)
  );
}

export function isAllowedPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > PUSH_ENDPOINT_MAX_LENGTH) return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || url.hash
    ) return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "fcm.googleapis.com"
      || host === "updates.push.services.mozilla.com"
      || host === "web.push.apple.com"
      || host.endsWith(".notify.windows.com")
    );
  } catch {
    return false;
  }
}

export function parsePushSubscription(value: unknown): PushSubscriptionInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as {
    endpoint?: unknown;
    expirationTime?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  const expirationTime = candidate.expirationTime ?? null;
  if (
    !isAllowedPushEndpoint(candidate.endpoint)
    || (expirationTime !== null && (
      typeof expirationTime !== "number"
      || !Number.isFinite(expirationTime)
      || expirationTime < 0
    ))
    || !validBase64Url(candidate.keys?.p256dh, 64, 256)
    || !validBase64Url(candidate.keys?.auth, 16, 128)
  ) {
    return null;
  }
  return {
    endpoint: candidate.endpoint,
    expirationTime,
    keys: {
      p256dh: candidate.keys.p256dh,
      auth: candidate.keys.auth,
    },
  };
}

export function isPushEndpointHash(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

async function pushEndpointHash(endpoint: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(endpoint),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decodeBase64Url(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (typeof value !== "string" || !UNPADDED_BASE64URL.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = atob(padded);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function validVapidSubject(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" && Boolean(url.hostname))
      || (url.protocol === "mailto:" && Boolean(url.pathname))
    );
  } catch {
    return false;
  }
}

async function runtimeConfig(): Promise<PushRuntimeConfig | null> {
  const publicKey = vapidPublicKey();
  const rawPrivateJwk = vapidPrivateJwk();
  const subject = vapidSubject();
  if (
    !publicKey
    || !rawPrivateJwk
    || !subject
    || !validVapidSubject(subject)
  ) {
    return null;
  }
  try {
    const privateJwk = JSON.parse(rawPrivateJwk) as JsonWebKey;
    const publicBytes = decodeBase64Url(publicKey);
    const x = decodeBase64Url(privateJwk.x);
    const y = decodeBase64Url(privateJwk.y);
    const d = decodeBase64Url(privateJwk.d);
    if (
      privateJwk.kty !== "EC"
      || privateJwk.crv !== "P-256"
      || publicBytes?.length !== 65
      || publicBytes[0] !== 4
      || x?.length !== 32
      || y?.length !== 32
      || d?.length !== 32
    ) {
      return null;
    }
    const reconstructedPublic = new Uint8Array(65);
    reconstructedPublic[0] = 4;
    reconstructedPublic.set(x, 1);
    reconstructedPublic.set(y, 33);
    if (!reconstructedPublic.every((byte, index) => byte === publicBytes[index])) {
      return null;
    }
    const [privateKey, verificationKey] = await Promise.all([
      crypto.subtle.importKey(
        "jwk",
        privateJwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign"],
      ),
      crypto.subtle.importKey(
        "raw",
        publicBytes,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      ),
    ]);
    const challenge = new TextEncoder().encode("chessriot-vapid-key-check");
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      challenge,
    );
    const matches = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      verificationKey,
      signature,
      challenge,
    );
    if (!matches) return null;
    return { publicKey, privateJwk, subject };
  } catch {
    return null;
  }
}

export async function publicPushConfig(): Promise<{
  enabled: boolean;
  publicKey: string | null;
}> {
  const config = await runtimeConfig();
  return {
    enabled: Boolean(config),
    publicKey: config?.publicKey ?? null,
  };
}

export async function upsertPushSubscription(
  gameId: string,
  color: Color,
  accountId: string,
  subscription: PushSubscriptionInput,
): Promise<void> {
  await ensureSchema();
  const db = getDatabase();
  const now = new Date().toISOString();
  const endpointHash = await pushEndpointHash(subscription.endpoint);
  await db
    .prepare(`INSERT INTO push_subscriptions (
      id, game_id, color, account_id, endpoint_hash, endpoint,
      p256dh, auth, expiration_time,
      created_at, updated_at, last_success_at, failure_count, disabled_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL)
    ON CONFLICT(game_id, color, endpoint_hash) DO UPDATE SET
      account_id = excluded.account_id,
      endpoint = excluded.endpoint,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      expiration_time = excluded.expiration_time,
      updated_at = excluded.updated_at,
      failure_count = 0,
      disabled_at = NULL`)
    .bind(
      crypto.randomUUID(),
      gameId,
      color,
      accountId,
      endpointHash,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      subscription.expirationTime,
      now,
      now,
    )
    .run();
  await db
    .prepare(`DELETE FROM push_subscriptions
      WHERE game_id = ? AND color = ? AND account_id = ? AND id NOT IN (
        SELECT id FROM push_subscriptions
        WHERE game_id = ? AND color = ? AND account_id = ?
        ORDER BY updated_at DESC
        LIMIT ?
      )`)
    .bind(
      gameId,
      color,
      accountId,
      gameId,
      color,
      accountId,
      MAX_SUBSCRIPTIONS_PER_SEAT,
    )
    .run();
}

export async function deletePushSubscription(
  gameId: string,
  color: Color,
  accountId: string,
  endpoint: string,
): Promise<void> {
  if (!isAllowedPushEndpoint(endpoint)) return;
  await ensureSchema();
  const endpointHash = await pushEndpointHash(endpoint);
  await getDatabase()
    .prepare(`DELETE FROM push_subscriptions
      WHERE game_id = ? AND color = ? AND account_id = ?
        AND endpoint_hash = ? AND endpoint = ?`)
    .bind(gameId, color, accountId, endpointHash, endpoint)
    .run();
}

export async function pushSubscriptionEnabled(
  gameId: string,
  color: Color,
  accountId: string,
  endpointHash: string,
): Promise<boolean> {
  if (!isPushEndpointHash(endpointHash)) return false;
  await ensureSchema();
  const row = await getDatabase()
    .prepare(`SELECT 1 AS enabled
      FROM push_subscriptions
      WHERE game_id = ? AND color = ? AND account_id = ?
        AND endpoint_hash = ?
        AND disabled_at IS NULL
        AND (expiration_time IS NULL OR expiration_time > ?)
      LIMIT 1`)
    .bind(gameId, color, accountId, endpointHash, Date.now())
    .first<{ enabled: number }>();
  return row?.enabled === 1;
}

function isTurnNotificationGame(value: unknown): value is TurnNotificationGame {
  if (!value || typeof value !== "object") return false;
  const game = value as Partial<TurnNotificationGame>;
  return (
    typeof game.id === "string"
    && game.mode === "multiplayer"
    && game.status === "active"
    && Number.isInteger(game.version)
    && (game.turn === "w" || game.turn === "b")
    && Boolean(game.you)
    && (game.you?.color === "w" || game.you?.color === "b")
  );
}

async function markDelivery(
  subscriptionId: string,
  gameId: string,
  gameVersion: number,
): Promise<string | null> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await getDatabase()
    .prepare(`INSERT OR IGNORE INTO push_deliveries (
      id, subscription_id, game_id, game_version, kind, status,
      status_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'your_turn', 'pending', NULL, ?, ?)`)
    .bind(id, subscriptionId, gameId, gameVersion, now, now)
    .run();
  return (result.meta.changes ?? 0) === 1 ? id : null;
}

async function updateDelivery(
  deliveryId: string,
  status: "sent" | "failed" | "stale",
  statusCode: number | null,
): Promise<void> {
  await getDatabase()
    .prepare(`UPDATE push_deliveries
      SET status = ?, status_code = ?, updated_at = ?
      WHERE id = ?`)
    .bind(status, statusCode, new Date().toISOString(), deliveryId)
    .run();
}

async function sendTurnPush(
  subscription: StoredPushSubscription,
  gameId: string,
  gameVersion: number,
  config: PushRuntimeConfig,
): Promise<"sent" | "failed" | "stale" | "duplicate"> {
  const deliveryId = await markDelivery(subscription.id, gameId, gameVersion);
  if (!deliveryId) return "duplicate";
  try {
    const target: PushSubscription = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    };
    const request = await generateRequestDetails(
      target,
      JSON.stringify({
        type: "your_turn",
        gameId,
      }),
      {
        vapidDetails: {
          publicKey: config.publicKey,
          privateKey: config.privateJwk.d!,
          subject: config.subject,
        },
        TTL: 24 * 60 * 60,
        urgency: "normal",
        topic: `turn-${gameId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 27)}`,
      },
    );
    const response = await fetch(request.endpoint, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      redirect: "manual",
    });
    if (response.ok) {
      const now = new Date().toISOString();
      await getDatabase()
        .prepare(`UPDATE push_subscriptions
          SET last_success_at = ?, failure_count = 0, disabled_at = NULL
          WHERE id = ?`)
        .bind(now, subscription.id)
        .run();
      await updateDelivery(deliveryId, "sent", response.status);
      return "sent";
    }
    if (response.status === 404 || response.status === 410) {
      await updateDelivery(deliveryId, "stale", response.status);
      await getDatabase()
        .prepare("DELETE FROM push_subscriptions WHERE endpoint = ?")
        .bind(subscription.endpoint)
        .run();
      return "stale";
    }
    await getDatabase()
      .prepare(`UPDATE push_subscriptions
        SET failure_count = failure_count + 1,
            disabled_at = CASE
              WHEN failure_count + 1 >= 3 THEN ?
              ELSE disabled_at
            END
        WHERE id = ?`)
      .bind(new Date().toISOString(), subscription.id)
      .run();
    await updateDelivery(deliveryId, "failed", response.status);
    return "failed";
  } catch {
    await getDatabase()
      .prepare(`UPDATE push_subscriptions
        SET failure_count = failure_count + 1,
            disabled_at = CASE
              WHEN failure_count + 1 >= 3 THEN ?
              ELSE disabled_at
            END
        WHERE id = ?`)
      .bind(new Date().toISOString(), subscription.id)
      .run();
    await updateDelivery(deliveryId, "failed", null);
    return "failed";
  }
}

async function deliverTurnNotifications(
  gameId: string,
  gameVersion: number,
  targetColor: Color,
): Promise<void> {
  await ensureSchema();
  const db = getDatabase();
  const subscriptions = await db
    .prepare(`SELECT id, endpoint, p256dh, auth, expiration_time
      FROM push_subscriptions
      WHERE game_id = ? AND color = ?
        AND disabled_at IS NULL
        AND (expiration_time IS NULL OR expiration_time > ?)
      ORDER BY updated_at DESC
      LIMIT ?`)
    .bind(
      gameId,
      targetColor,
      Date.now(),
      MAX_SUBSCRIPTIONS_PER_SEAT,
    )
    .all<StoredPushSubscription>();
  const active = subscriptions.results ?? [];
  if (active.length === 0) return;
  const config = await runtimeConfig();
  if (!config) return;
  const outcomes = await Promise.all(
    active.map((subscription) =>
      sendTurnPush(subscription, gameId, gameVersion, config)),
  );
  const sent = outcomes.filter((outcome) => outcome === "sent").length;
  const stale = outcomes.filter((outcome) => outcome === "stale").length;
  const failed = outcomes.filter((outcome) => outcome === "failed").length;
  await recordEvent({
    event: "push.turn_delivered",
    outcome: failed > 0 && sent === 0 ? "failure" : "success",
    subjectId: gameId,
    metadata: {
      attempted: active.length,
      sent,
      stale,
      failed,
    },
  });
  await db
    .prepare("DELETE FROM push_deliveries WHERE created_at < ?")
    .bind(new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString())
    .run();
}

export async function deliverCommittedTurnNotification(
  response: Response,
): Promise<void> {
  try {
    const payload = await response.json() as { game?: unknown };
    if (!isTurnNotificationGame(payload.game)) return;
    if (payload.game.turn === payload.game.you.color) return;
    await deliverTurnNotifications(
      payload.game.id,
      payload.game.version,
      payload.game.turn,
    );
  } catch {
    // Notification delivery is best-effort and must never affect a chess move.
  }
}
