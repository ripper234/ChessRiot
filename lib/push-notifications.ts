import {
  generateRequestDetails,
  type PushSubscription,
} from "web-push-neo";
import { ensureSchema, getDatabase } from "@/db";
import { findAccountByUsername } from "./accounts";
import { turnDeadlineExpired } from "./game-deadlines";
import type { Color, TurnPaceDays } from "./game-types";
import { recordEvent } from "./observability";
import type { PushDrainResult } from "./push-drain";
import {
  vapidPrivateJwk,
  vapidPublicKey,
  vapidSubject,
} from "./runtime";

const MAX_SUBSCRIPTIONS_PER_SEAT = 6;
const MAX_DEVICES_PER_ACCOUNT = 6;
const MAX_DELIVERIES_PER_DRAIN = MAX_SUBSCRIPTIONS_PER_SEAT + MAX_DEVICES_PER_ACCOUNT;
const MAX_DELIVERY_ATTEMPTS = 6;
const DELIVERY_LEASE_MS = 30_000;
const DELIVERY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const DELIVERY_RETRY_DELAYS_MS = [
  2_000,
  15_000,
  60_000,
  5 * 60_000,
  30 * 60_000,
];
const PUSH_TIMEOUT_MS = 5_000;
const PUSH_ENDPOINT_MAX_LENGTH = 2_048;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const PUSH_TEST_SCOPE = "push_service_test";
const PUSH_TEST_GLOBAL_HOURLY_LIMIT = 30;
const PUSH_TEST_ACCOUNT_HOURLY_LIMIT = 10;
const PUSH_TEST_NONCE_TTL_MS = 24 * 60 * 60 * 1_000;

type DeliveryTable = "push_deliveries" | "push_turn_deliveries" | "push_account_deliveries";

interface StoredPushTarget {
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

type PushDeliverySource = "account" | "legacy";

interface ClaimedPushDelivery extends StoredPushTarget {
  source: PushDeliverySource;
  delivery_id: string;
  game_id: string;
  game_version: number;
  attempt_count: number;
  created_at: string;
  lease_token: string;
  target_disabled_at: string | null;
  game_status: "waiting" | "active" | "completed";
  current_version: number;
  current_turn: Color;
  game_updated_at: string;
  turn_pace_days: TurnPaceDays | null;
  target_color: Color;
}

interface ClaimedAccountDelivery extends StoredPushTarget {
  delivery_id: string;
  friend_request_id: string;
  attempt_count: number;
  created_at: string;
  lease_token: string;
  target_disabled_at: string | null;
  device_account_id: string;
  recipient_account_id: string;
  request_status: "pending" | "accepted" | "declined";
  sender_username: string;
  blocked: number;
}

async function expireUndeliverableRows(
  table: DeliveryTable,
  nowMs: number,
): Promise<number> {
  const updatedAt = new Date(nowMs).toISOString();
  const result = await getDatabase().prepare(`UPDATE ${table}
    SET status = 'dead', lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE status IN ('pending', 'failed')
      AND (lease_until IS NULL OR lease_until <= ?)
      AND (attempt_count >= ? OR created_at < ?)`)
    .bind(
      updatedAt,
      nowMs,
      MAX_DELIVERY_ATTEMPTS,
      new Date(nowMs - DELIVERY_MAX_AGE_MS).toISOString(),
    )
    .run();
  return result.meta.changes ?? 0;
}

async function nextDeliveryAttempt(
  lane: "turn" | "account",
  nowMs: number,
): Promise<number | null> {
  const source = lane === "account"
    ? "SELECT status, next_attempt_at, lease_until, attempt_count, created_at FROM push_account_deliveries"
    : `SELECT status, next_attempt_at, lease_until, attempt_count, created_at FROM push_turn_deliveries
       UNION ALL
       SELECT status, next_attempt_at, lease_until, attempt_count, created_at FROM push_deliveries`;
  const row = await getDatabase().prepare(`SELECT
      MIN(MAX(next_attempt_at, COALESCE(lease_until, 0))) AS next_attempt_at
    FROM (${source})
    WHERE status IN ('pending', 'failed')
      AND attempt_count < ? AND created_at >= ?`)
    .bind(MAX_DELIVERY_ATTEMPTS, new Date(nowMs - DELIVERY_MAX_AGE_MS).toISOString())
    .first<{ next_attempt_at: number | null }>();
  return row?.next_attempt_at ?? null;
}

export type PushServiceMessageResult =
  | {
    ok: true;
    username: string;
    active: number;
    accepted: number;
    stale: number;
    failed: number;
    providerAuth: number;
    retryable: number;
    endpointRejected: number;
  }
  | {
    ok: false;
    code:
      | "player_not_found"
      | "no_subscribed_devices"
      | "push_unconfigured"
      | "grant_already_used"
      | "grant_in_progress"
      | "rate_limited";
  };

interface StoredPushServiceResult {
  active: number;
  accepted: number;
  stale: number;
  failed: number;
  providerAuth: number;
  retryable: number;
  endpointRejected: number;
}

type PushServiceDeviceOutcome =
  | "accepted"
  | "stale"
  | "provider_auth"
  | "retryable"
  | "endpoint_rejected";

function parseStoredPushServiceResult(value: string | null): StoredPushServiceResult | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredPushServiceResult>;
    const fields = [
      parsed.active,
      parsed.accepted,
      parsed.stale,
      parsed.failed,
      parsed.providerAuth,
      parsed.retryable,
      parsed.endpointRejected,
    ];
    const valid = fields.every((field) => Number.isInteger(field) && Number(field) >= 0)
      && Number(parsed.active) >= 1
      && Number(parsed.active) <= MAX_DEVICES_PER_ACCOUNT
      && Number(parsed.accepted) + Number(parsed.stale) + Number(parsed.failed)
        === Number(parsed.active)
      && Number(parsed.providerAuth) + Number(parsed.retryable) + Number(parsed.endpointRejected)
        === Number(parsed.failed);
    return valid ? parsed as StoredPushServiceResult : null;
  } catch {
    return null;
  }
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
      || expirationTime <= Date.now()
    ))
    || !validBase64Url(candidate.keys?.p256dh, 64, 256)
    || !validBase64Url(candidate.keys?.auth, 16, 128)
  ) {
    return null;
  }
  const p256dh = decodeBase64Url(candidate.keys.p256dh);
  const auth = decodeBase64Url(candidate.keys.auth);
  if (p256dh?.length !== 65 || p256dh[0] !== 4 || auth?.length !== 16) {
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

export async function upsertPushDevice(
  accountId: string,
  subscription: PushSubscriptionInput,
): Promise<"registered" | "stale"> {
  await ensureSchema();
  const database = getDatabase();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const endpointHash = await pushEndpointHash(subscription.endpoint);
  const registered = await database.prepare(`INSERT INTO push_devices (
      id, account_id, endpoint_hash, endpoint, p256dh, auth, expiration_time,
      created_at, updated_at, last_success_at, failure_count, disabled_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM (
        SELECT endpoint, p256dh, auth, expiration_time, disabled_at
        FROM push_devices WHERE endpoint_hash = ?
        UNION ALL
        SELECT endpoint, p256dh, auth, expiration_time, disabled_at
        FROM push_subscriptions WHERE endpoint_hash = ?
      ) AS stale_target
      WHERE endpoint = ? AND p256dh = ? AND auth = ?
        AND (disabled_at IS NOT NULL OR (expiration_time IS NOT NULL AND expiration_time <= ?))
        AND NOT EXISTS (
          SELECT 1 FROM push_devices AS active
          WHERE active.endpoint_hash = ?
            AND active.endpoint = ? AND active.p256dh = ? AND active.auth = ?
            AND active.disabled_at IS NULL
            AND (active.expiration_time IS NULL OR active.expiration_time > ?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM push_subscriptions AS active
          WHERE active.endpoint_hash = ?
            AND active.endpoint = ? AND active.p256dh = ? AND active.auth = ?
            AND active.disabled_at IS NULL
            AND (active.expiration_time IS NULL OR active.expiration_time > ?)
        )
    )
    ON CONFLICT(endpoint_hash) DO UPDATE SET
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
      accountId,
      endpointHash,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      subscription.expirationTime,
      now,
      now,
      endpointHash,
      endpointHash,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      nowMs,
      endpointHash,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      nowMs,
      endpointHash,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      nowMs,
    )
    .run();
  if ((registered.meta.changes ?? 0) !== 1) return "stale";
  await database.batch([
    database.prepare(`DELETE FROM push_turn_deliveries
      WHERE device_id IN (
        SELECT id FROM push_devices WHERE endpoint_hash = ? AND endpoint = ?
      )
      AND NOT EXISTS (
        SELECT 1
        FROM push_devices AS devices
        JOIN game_memberships AS memberships
          ON memberships.account_id = devices.account_id
          AND memberships.game_id = push_turn_deliveries.game_id
        WHERE devices.id = push_turn_deliveries.device_id
      )`)
      .bind(endpointHash, subscription.endpoint),
    database.prepare(`UPDATE push_subscriptions
      SET disabled_at = COALESCE(disabled_at, ?), updated_at = ?
      WHERE endpoint_hash = ? AND endpoint = ?`)
      .bind(now, now, endpointHash, subscription.endpoint),
    database.prepare(`UPDATE push_devices
      SET disabled_at = COALESCE(disabled_at, ?), updated_at = ?
      WHERE account_id = ?
        AND disabled_at IS NULL
        AND (expiration_time IS NULL OR expiration_time > ?)
        AND id NOT IN (
        SELECT id FROM push_devices
        WHERE account_id = ?
          AND disabled_at IS NULL
          AND (expiration_time IS NULL OR expiration_time > ?)
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      )`)
      .bind(now, now, accountId, nowMs, accountId, nowMs, MAX_DEVICES_PER_ACCOUNT),
  ]);
  return "registered";
}

export async function deletePushDevice(
  accountId: string,
  endpoint: string,
  options: { preserveLegacy?: boolean } = {},
): Promise<void> {
  if (!isAllowedPushEndpoint(endpoint)) return;
  await ensureSchema();
  const endpointHash = await pushEndpointHash(endpoint);
  const database = getDatabase();
  const statements = [
    database.prepare(`DELETE FROM push_devices
      WHERE account_id = ? AND endpoint_hash = ? AND endpoint = ?`)
      .bind(accountId, endpointHash, endpoint),
  ];
  if (!options.preserveLegacy) {
    statements.push(database.prepare(`DELETE FROM push_subscriptions
      WHERE account_id = ? AND endpoint_hash = ? AND endpoint = ?`)
      .bind(accountId, endpointHash, endpoint));
  }
  await database.batch(statements);
}

export async function pushDeviceEnabled(
  accountId: string,
  endpointHash: string,
): Promise<boolean> {
  return (await pushDeviceStatus(accountId, endpointHash)).enabled;
}

export async function pushDeviceStatus(
  accountId: string,
  endpointHash: string,
): Promise<{ enabled: boolean; owned: boolean; legacy: boolean; stale: boolean }> {
  if (!isPushEndpointHash(endpointHash)) {
    return { enabled: false, owned: false, legacy: false, stale: false };
  }
  await ensureSchema();
  const nowMs = Date.now();
  const row = await getDatabase().prepare(`SELECT
      EXISTS (
        SELECT 1 FROM push_devices
        WHERE account_id = ? AND endpoint_hash = ?
          AND disabled_at IS NULL
          AND (expiration_time IS NULL OR expiration_time > ?)
      ) AS enabled,
      EXISTS (
        SELECT 1 FROM push_devices
        WHERE account_id = ? AND endpoint_hash = ?
          AND disabled_at IS NULL
          AND (expiration_time IS NULL OR expiration_time > ?)
        UNION ALL
        SELECT 1 FROM push_subscriptions
        WHERE account_id = ? AND endpoint_hash = ?
          AND disabled_at IS NULL
          AND (expiration_time IS NULL OR expiration_time > ?)
      ) AS owned,
      EXISTS (
        SELECT 1 FROM push_subscriptions
        WHERE account_id = ? AND endpoint_hash = ?
          AND disabled_at IS NULL
          AND (expiration_time IS NULL OR expiration_time > ?)
      ) AS legacy,
      CASE WHEN EXISTS (
        SELECT 1 FROM push_devices
        WHERE endpoint_hash = ?
          AND disabled_at IS NULL
          AND (expiration_time IS NULL OR expiration_time > ?)
        UNION ALL
        SELECT 1 FROM push_subscriptions
        WHERE endpoint_hash = ?
          AND disabled_at IS NULL
          AND (expiration_time IS NULL OR expiration_time > ?)
      ) THEN 0 ELSE EXISTS (
          SELECT 1 FROM push_devices
          WHERE endpoint_hash = ?
            AND (disabled_at IS NOT NULL OR (expiration_time IS NOT NULL AND expiration_time <= ?))
          UNION ALL
          SELECT 1 FROM push_subscriptions
          WHERE endpoint_hash = ?
            AND (disabled_at IS NOT NULL OR (expiration_time IS NOT NULL AND expiration_time <= ?))
        ) END AS stale`)
    .bind(
      accountId,
      endpointHash,
      nowMs,
      accountId,
      endpointHash,
      nowMs,
      accountId,
      endpointHash,
      nowMs,
      accountId,
      endpointHash,
      nowMs,
      endpointHash,
      nowMs,
      endpointHash,
      nowMs,
      endpointHash,
      nowMs,
      endpointHash,
      nowMs,
    )
    .first<{ enabled: number; owned: number; legacy: number; stale: number }>();
  if (row?.enabled === 1) {
    await getDatabase().prepare(`UPDATE push_devices SET updated_at = ?
      WHERE account_id = ? AND endpoint_hash = ?`)
      .bind(new Date().toISOString(), accountId, endpointHash)
      .run();
  }
  return {
    enabled: row?.enabled === 1,
    owned: row?.owned === 1,
    legacy: row?.legacy === 1,
    stale: row?.stale === 1,
  };
}

export async function pushDeviceSummaryByUsername(
  username: string,
): Promise<{
  ok: true;
  username: string;
  activeSubscriptions: number;
  lastAcceptedAt: string | null;
} | { ok: false; code: "player_not_found" }> {
  const account = await findAccountByUsername(username);
  if (!account?.username) return { ok: false, code: "player_not_found" };
  await ensureSchema();
  const row = await getDatabase().prepare(`SELECT
      COUNT(*) AS active_subscriptions,
      MAX(last_success_at) AS last_accepted_at
    FROM push_devices
    WHERE account_id = ? AND disabled_at IS NULL
      AND (expiration_time IS NULL OR expiration_time > ?)`)
    .bind(account.id, Date.now())
    .first<{ active_subscriptions: number; last_accepted_at: string | null }>();
  return {
    ok: true,
    username: account.username,
    activeSubscriptions: Number(row?.active_subscriptions ?? 0),
    lastAcceptedAt: row?.last_accepted_at ?? null,
  };
}

export async function upsertPushSubscription(
  gameId: string,
  color: Color,
  accountId: string,
  subscription: PushSubscriptionInput,
): Promise<"registered" | "stale"> {
  await ensureSchema();
  const db = getDatabase();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const endpointHash = await pushEndpointHash(subscription.endpoint);
  const registered = await db
    .prepare(`INSERT INTO push_subscriptions (
      id, game_id, color, account_id, endpoint_hash, endpoint,
      p256dh, auth, expiration_time,
      created_at, updated_at, last_success_at, failure_count, disabled_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM (
        SELECT endpoint, p256dh, auth, expiration_time, disabled_at
        FROM push_devices WHERE endpoint_hash = ?
        UNION ALL
        SELECT endpoint, p256dh, auth, expiration_time, disabled_at
        FROM push_subscriptions WHERE endpoint_hash = ?
      ) AS stale_target
      WHERE endpoint = ? AND p256dh = ? AND auth = ?
        AND (disabled_at IS NOT NULL OR (expiration_time IS NOT NULL AND expiration_time <= ?))
        AND NOT EXISTS (
          SELECT 1 FROM push_devices AS active
          WHERE active.endpoint_hash = ?
            AND active.endpoint = ? AND active.p256dh = ? AND active.auth = ?
            AND active.disabled_at IS NULL
            AND (active.expiration_time IS NULL OR active.expiration_time > ?)
        )
        AND NOT EXISTS (
          SELECT 1 FROM push_subscriptions AS active
          WHERE active.endpoint_hash = ?
            AND active.endpoint = ? AND active.p256dh = ? AND active.auth = ?
            AND active.disabled_at IS NULL
            AND (active.expiration_time IS NULL OR active.expiration_time > ?)
        )
    )
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
      endpointHash,
      endpointHash,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      nowMs,
      endpointHash,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      nowMs,
      endpointHash,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      nowMs,
    )
    .run();
  if ((registered.meta.changes ?? 0) !== 1) return "stale";
  await db
    .prepare(`UPDATE push_subscriptions
      SET disabled_at = COALESCE(disabled_at, ?), updated_at = ?
      WHERE game_id = ? AND color = ? AND account_id = ?
        AND disabled_at IS NULL
        AND (expiration_time IS NULL OR expiration_time > ?)
        AND id NOT IN (
        SELECT id FROM push_subscriptions
        WHERE game_id = ? AND color = ? AND account_id = ?
          AND disabled_at IS NULL
          AND (expiration_time IS NULL OR expiration_time > ?)
        ORDER BY updated_at DESC
        LIMIT ?
      )`)
    .bind(
      now,
      now,
      gameId,
      color,
      accountId,
      nowMs,
      gameId,
      color,
      accountId,
      nowMs,
      MAX_SUBSCRIPTIONS_PER_SEAT,
    )
    .run();
  return "registered";
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

export function queueTurnNotifications(
  database: D1Database,
  input: {
    gameId: string;
    gameVersion: number;
    targetColor: Color;
    mutationNonce: string;
    createdAt: string;
    nowMs?: number;
  },
): D1PreparedStatement[] {
  const nowMs = input.nowMs ?? Date.now();
  const legacy = database.prepare(`INSERT OR IGNORE INTO push_deliveries (
      id, subscription_id, game_id, game_version, kind, status,
      status_code, attempt_count, next_attempt_at, lease_token, lease_until,
      created_at, updated_at
    )
    SELECT
      subscriptions.id || ':' || ? || ':your_turn',
      subscriptions.id, subscriptions.game_id, ?, 'your_turn', 'pending',
      NULL, 0, ?, NULL, NULL, ?, ?
    FROM push_subscriptions AS subscriptions
    JOIN game_memberships AS memberships
      ON memberships.game_id = subscriptions.game_id
      AND memberships.color = subscriptions.color
      AND memberships.account_id = subscriptions.account_id
    JOIN games ON games.id = subscriptions.game_id
    WHERE subscriptions.game_id = ?
      AND subscriptions.color = ?
      AND subscriptions.disabled_at IS NULL
      AND (subscriptions.expiration_time IS NULL OR subscriptions.expiration_time > ?)
      AND NOT EXISTS (
        SELECT 1 FROM push_devices AS devices
        WHERE devices.account_id = subscriptions.account_id
          AND devices.endpoint_hash = subscriptions.endpoint_hash
          AND devices.disabled_at IS NULL
          AND (devices.expiration_time IS NULL OR devices.expiration_time > ?)
      )
      AND games.version = ?
      AND games.last_mutation_nonce = ?
      AND games.status = 'active'
      AND games.turn_color = ?
    ORDER BY subscriptions.updated_at DESC
    LIMIT ?`)
    .bind(
      input.gameVersion,
      input.gameVersion,
      nowMs,
      input.createdAt,
      input.createdAt,
      input.gameId,
      input.targetColor,
      nowMs,
      nowMs,
      input.gameVersion,
      input.mutationNonce,
      input.targetColor,
      MAX_SUBSCRIPTIONS_PER_SEAT,
    );
  const account = database.prepare(`INSERT OR IGNORE INTO push_turn_deliveries (
      id, device_id, game_id, game_version, kind, status,
      status_code, attempt_count, next_attempt_at, lease_token, lease_until,
      created_at, updated_at
    )
    SELECT
      devices.id || ':' || games.id || ':' || ? || ':your_turn',
      devices.id, games.id, ?, 'your_turn', 'pending',
      NULL, 0, ?, NULL, NULL, ?, ?
    FROM game_memberships AS memberships
    JOIN push_devices AS devices ON devices.account_id = memberships.account_id
    JOIN games ON games.id = memberships.game_id
    WHERE memberships.game_id = ?
      AND memberships.color = ?
      AND devices.disabled_at IS NULL
      AND (devices.expiration_time IS NULL OR devices.expiration_time > ?)
      AND games.version = ?
      AND games.last_mutation_nonce = ?
      AND games.status = 'active'
      AND games.turn_color = ?
    ORDER BY devices.updated_at DESC
    LIMIT ?`)
    .bind(
      input.gameVersion,
      input.gameVersion,
      nowMs,
      input.createdAt,
      input.createdAt,
      input.gameId,
      input.targetColor,
      nowMs,
      input.gameVersion,
      input.mutationNonce,
      input.targetColor,
      MAX_DEVICES_PER_ACCOUNT,
    );
  return [account, legacy];
}

export function queueFriendRequestNotifications(
  database: D1Database,
  input: {
    friendRequestId: string;
    recipientAccountId: string;
    createdAt: string;
    nowMs?: number;
  },
): D1PreparedStatement {
  const nowMs = input.nowMs ?? Date.now();
  return database.prepare(`INSERT OR IGNORE INTO push_account_deliveries (
      id, device_id, friend_request_id, kind, status, status_code,
      attempt_count, next_attempt_at, lease_token, lease_until, created_at, updated_at
    )
    SELECT
      devices.id || ':' || ? || ':friend_request', devices.id, ?, 'friend_request',
      'pending', NULL, 0, ?, NULL, NULL, ?, ?
    FROM push_devices AS devices
    WHERE devices.account_id = ?
      AND devices.disabled_at IS NULL
      AND (devices.expiration_time IS NULL OR devices.expiration_time > ?)
    ORDER BY devices.updated_at DESC, devices.id DESC
    LIMIT ?
    ON CONFLICT(device_id, friend_request_id, kind) DO UPDATE SET
      status = 'pending',
      status_code = NULL,
      attempt_count = 0,
      next_attempt_at = excluded.next_attempt_at,
      lease_token = NULL,
      lease_until = NULL,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
    WHERE push_account_deliveries.status IN ('sent', 'stale', 'dead', 'superseded')
      AND push_account_deliveries.created_at <= ?`)
    .bind(
      input.friendRequestId,
      input.friendRequestId,
      nowMs,
      input.createdAt,
      input.createdAt,
      input.recipientAccountId,
      nowMs,
      MAX_DEVICES_PER_ACCOUNT,
      new Date(nowMs - 60 * 60 * 1_000).toISOString(),
    );
}

async function opaquePushTopic(gameId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`chessriot-turn:${gameId}`),
  );
  const binary = Array.from(new Uint8Array(digest), (byte) =>
    String.fromCharCode(byte)).join("");
  return `turn-${btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
    .slice(0, 27)}`;
}

async function servicePushTopic(nonce: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`chessriot-service:${nonce}`),
  );
  const binary = Array.from(new Uint8Array(digest), (byte) =>
    String.fromCharCode(byte)).join("");
  return `service-${btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")
    .slice(0, 24)}`;
}

async function reserveServicePushCommand(
  nonce: string,
  accountId: string,
): Promise<
  | { state: "reserved" }
  | { state: "replayed"; result: StoredPushServiceResult | null }
  | { state: "rate_limited" }
> {
  const database = getDatabase();
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const cutoff = new Date(nowMs - 60 * 60 * 1_000).toISOString();
  await database.prepare("DELETE FROM ops_action_nonces WHERE expires_at <= ?")
    .bind(nowMs)
    .run();
  const inserted = await database.prepare(`INSERT OR IGNORE INTO ops_action_nonces (
      nonce, scope, subject_key, used_at, expires_at
    )
    SELECT ?, ?, ?, ?, ?
    WHERE (
      SELECT COUNT(*) FROM ops_action_nonces
      WHERE scope = ? AND used_at >= ?
    ) < ?
    AND (
      SELECT COUNT(*) FROM ops_action_nonces
      WHERE scope = ? AND subject_key = ? AND used_at >= ?
    ) < ?`)
    .bind(
      nonce,
      PUSH_TEST_SCOPE,
      accountId,
      now,
      nowMs + PUSH_TEST_NONCE_TTL_MS,
      PUSH_TEST_SCOPE,
      cutoff,
      PUSH_TEST_GLOBAL_HOURLY_LIMIT,
      PUSH_TEST_SCOPE,
      accountId,
      cutoff,
      PUSH_TEST_ACCOUNT_HOURLY_LIMIT,
    )
    .run();
  if ((inserted.meta.changes ?? 0) === 1) return { state: "reserved" };
  const existing = await database.prepare(
    `SELECT result_json FROM ops_action_nonces
      WHERE nonce = ? AND scope = ? AND subject_key = ? LIMIT 1`,
  )
    .bind(nonce, PUSH_TEST_SCOPE, accountId)
    .first<{ result_json: string | null }>();
  if (!existing) return { state: "rate_limited" };
  return {
    state: "replayed",
    result: parseStoredPushServiceResult(existing.result_json),
  };
}

async function existingServicePushCommand(
  nonce: string,
  accountId: string,
): Promise<{ found: false } | { found: true; result: StoredPushServiceResult | null }> {
  const row = await getDatabase().prepare(`SELECT result_json
    FROM ops_action_nonces
    WHERE nonce = ? AND scope = ? AND subject_key = ?
    LIMIT 1`)
    .bind(nonce, PUSH_TEST_SCOPE, accountId)
    .first<{ result_json: string | null }>();
  return row
    ? { found: true, result: parseStoredPushServiceResult(row.result_json) }
    : { found: false };
}

async function sendServicePushToDevice(
  device: StoredPushTarget,
  body: string,
  nonce: string,
  config: PushRuntimeConfig,
): Promise<PushServiceDeviceOutcome> {
  const topic = await servicePushTopic(nonce);
  return await sendPushPayloadToDevice(
    device,
    {
      type: "service",
      body,
      notificationId: topic,
    },
    config,
    {
      ttl: 10 * 60,
      urgency: "high",
      topic,
    },
  );
}

async function disableGloballyStalePushTarget(
  target: StoredPushTarget,
  source: PushDeliverySource,
): Promise<boolean> {
  const database = getDatabase();
  const disabledAt = new Date().toISOString();
  await database.batch([
    database.prepare(`UPDATE push_devices
      SET disabled_at = COALESCE(disabled_at, ?), updated_at = ?,
          failure_count = failure_count + 1
      WHERE endpoint = ? AND p256dh = ? AND auth = ?`)
      .bind(
        disabledAt,
        disabledAt,
        target.endpoint,
        target.p256dh,
        target.auth,
      ),
    database.prepare(`UPDATE push_subscriptions
      SET disabled_at = COALESCE(disabled_at, ?), updated_at = ?,
          failure_count = failure_count + 1
      WHERE endpoint = ? AND p256dh = ? AND auth = ?`)
      .bind(
        disabledAt,
        disabledAt,
        target.endpoint,
        target.p256dh,
        target.auth,
      ),
  ]);
  const targets = source === "account" ? "push_devices" : "push_subscriptions";
  const retained = await database.prepare(`SELECT 1 AS retained FROM ${targets}
    WHERE id = ? AND endpoint = ? AND p256dh = ? AND auth = ?
      AND disabled_at IS NOT NULL
    LIMIT 1`)
    .bind(target.id, target.endpoint, target.p256dh, target.auth)
    .first<{ retained: number }>();
  return Boolean(retained);
}

async function sendPushPayloadToDevice(
  device: StoredPushTarget,
  payload: Record<string, string>,
  config: PushRuntimeConfig,
  options: {
    ttl: number;
    urgency: "very-low" | "low" | "normal" | "high";
    topic: string;
  },
): Promise<PushServiceDeviceOutcome> {
  let response: Response;
  try {
    const target: PushSubscription = {
      endpoint: device.endpoint,
      keys: { p256dh: device.p256dh, auth: device.auth },
    };
    const request = await generateRequestDetails(
      target,
      JSON.stringify(payload),
      {
        vapidDetails: {
          publicKey: config.publicKey,
          privateKey: config.privateJwk.d!,
          subject: config.subject,
        },
        TTL: options.ttl,
        urgency: options.urgency,
        topic: options.topic,
      },
    );
    response = await fetch(request.endpoint, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      redirect: "manual",
    });
  } catch {
    return "retryable";
  }
  if (response.ok) {
    try {
      await getDatabase().prepare(`UPDATE push_devices
        SET last_success_at = ?, failure_count = 0
        WHERE id = ? AND endpoint = ? AND p256dh = ? AND auth = ?
          AND disabled_at IS NULL`)
        .bind(
          new Date().toISOString(),
          device.id,
          device.endpoint,
          device.p256dh,
          device.auth,
        )
        .run();
    } catch {
      // Provider acceptance is authoritative even if best-effort metadata fails.
    }
    return "accepted";
  }
  if (response.status === 404 || response.status === 410) {
    try {
      if (!await disableGloballyStalePushTarget(device, "account")) return "retryable";
    } catch {
      // A concurrent key rotation must be retried against the current target.
      return "retryable";
    }
    return "stale";
  }
  if (response.status === 401 || response.status === 403) return "provider_auth";
  if (
    response.status === 408
    || response.status === 425
    || response.status === 429
    || response.status >= 500
  ) return "retryable";
  try {
    await getDatabase().prepare(`UPDATE push_devices
      SET failure_count = failure_count + 1,
          disabled_at = CASE WHEN failure_count + 1 >= 3 THEN ? ELSE disabled_at END
      WHERE id = ? AND endpoint = ? AND p256dh = ? AND auth = ?`)
      .bind(
        new Date().toISOString(),
        device.id,
        device.endpoint,
        device.p256dh,
        device.auth,
      )
      .run();
  } catch {
    // Failure bookkeeping must not change the observed provider outcome.
  }
  return "endpoint_rejected";
}

export async function sendPushDeviceTest(
  accountId: string,
  endpoint: string,
  nonce: string,
): Promise<PushServiceDeviceOutcome | "not_found" | "unconfigured"> {
  if (!isAllowedPushEndpoint(endpoint)) return "not_found";
  await ensureSchema();
  const endpointHash = await pushEndpointHash(endpoint);
  const device = await getDatabase().prepare(`SELECT
      id, endpoint, p256dh, auth, expiration_time
    FROM push_devices
    WHERE account_id = ? AND endpoint_hash = ? AND endpoint = ?
      AND disabled_at IS NULL
      AND (expiration_time IS NULL OR expiration_time > ?)
    LIMIT 1`)
    .bind(accountId, endpointHash, endpoint, Date.now())
    .first<StoredPushTarget>();
  if (!device) return "not_found";
  const config = await runtimeConfig();
  if (!config) return "unconfigured";
  const outcome = await sendPushPayloadToDevice(
    device,
    {
      type: "service",
      body: "Server delivery test: ChessRiot reached this device.",
      notificationId: nonce.slice(0, 64),
      diagnosticId: nonce,
    },
    config,
    {
      ttl: 5 * 60,
      urgency: "high",
      topic: await servicePushTopic(nonce),
    },
  );
  await recordEvent({
    event: "push.device_self_test",
    outcome: outcome === "accepted" ? "success" : "failure",
    subjectId: accountId,
    errorCode: outcome === "accepted" ? undefined : outcome,
  });
  return outcome;
}

export async function sendPushServiceMessage(
  username: string,
  body: string,
  nonce: string,
): Promise<PushServiceMessageResult> {
  const account = await findAccountByUsername(username);
  if (!account?.username) return { ok: false, code: "player_not_found" };
  await ensureSchema();
  const existingCommand = await existingServicePushCommand(nonce, account.id);
  if (existingCommand.found) {
    return existingCommand.result
      ? { ok: true, username: account.username, ...existingCommand.result }
      : { ok: false, code: "grant_in_progress" };
  }
  const nowMs = Date.now();
  const devices = await getDatabase().prepare(`SELECT
      id, endpoint, p256dh, auth, expiration_time
    FROM push_devices
    WHERE account_id = ? AND disabled_at IS NULL
      AND (expiration_time IS NULL OR expiration_time > ?)
    ORDER BY updated_at DESC, id DESC
    LIMIT ?`)
    .bind(account.id, nowMs, MAX_DEVICES_PER_ACCOUNT)
    .all<StoredPushTarget>();
  const active = devices.results ?? [];
  if (active.length === 0) return { ok: false, code: "no_subscribed_devices" };
  const config = await runtimeConfig();
  if (!config) return { ok: false, code: "push_unconfigured" };
  const reservation = await reserveServicePushCommand(nonce, account.id);
  if (reservation.state === "replayed") {
    return reservation.result
      ? { ok: true, username: account.username, ...reservation.result }
      : { ok: false, code: "grant_in_progress" };
  }
  if (reservation.state === "rate_limited") return { ok: false, code: "rate_limited" };

  const outcomes = await Promise.all(
    active.map((device) => sendServicePushToDevice(device, body, nonce, config)),
  );
  const providerAuth = outcomes.filter((outcome) => outcome === "provider_auth").length;
  const retryable = outcomes.filter((outcome) => outcome === "retryable").length;
  const endpointRejected = outcomes.filter((outcome) => outcome === "endpoint_rejected").length;
  const storedResult: StoredPushServiceResult = {
    active: active.length,
    accepted: outcomes.filter((outcome) => outcome === "accepted").length,
    stale: outcomes.filter((outcome) => outcome === "stale").length,
    failed: providerAuth + retryable + endpointRejected,
    providerAuth,
    retryable,
    endpointRejected,
  };
  try {
    await getDatabase().prepare(`UPDATE ops_action_nonces SET result_json = ?
      WHERE nonce = ? AND scope = ? AND subject_key = ? AND result_json IS NULL`)
      .bind(JSON.stringify(storedResult), nonce, PUSH_TEST_SCOPE, account.id)
      .run();
  } catch {
    // Never turn a provider result into a reported failure because audit persistence failed.
  }
  const result = {
    ok: true as const,
    username: account.username,
    ...storedResult,
  };
  await recordEvent({
    event: "push.service_message",
    outcome: result.accepted > 0 ? "success" : "failure",
    subjectId: account.id,
    metadata: {
      active: result.active,
      accepted: result.accepted,
      stale: result.stale,
      failed: result.failed,
    },
  });
  return result;
}

async function claimDelivery(nowMs: number): Promise<ClaimedPushDelivery | null> {
  const database = getDatabase();
  for (let pass = 0; pass < 3; pass += 1) {
    const candidate = await database.prepare(`SELECT id, source FROM (
        SELECT id, 'account' AS source, status, next_attempt_at, lease_until,
          attempt_count, created_at
        FROM push_turn_deliveries
        UNION ALL
        SELECT id, 'legacy' AS source, status, next_attempt_at, lease_until,
          attempt_count, created_at
        FROM push_deliveries
      )
      WHERE status IN ('pending', 'failed')
        AND next_attempt_at <= ?
        AND (lease_until IS NULL OR lease_until <= ?)
        AND attempt_count < ?
        AND created_at >= ?
      ORDER BY CASE WHEN attempt_count = 0 THEN 0 ELSE 1 END,
        next_attempt_at ASC, created_at ASC, id ASC, source ASC
      LIMIT 1`)
      .bind(
        nowMs,
        nowMs,
        MAX_DELIVERY_ATTEMPTS,
        new Date(nowMs - DELIVERY_MAX_AGE_MS).toISOString(),
      )
      .first<{ id: string; source: PushDeliverySource }>();
    if (!candidate) return null;
    const source: PushDeliverySource = candidate.source === "legacy" ? "legacy" : "account";
    const deliveries = source === "account" ? "push_turn_deliveries" : "push_deliveries";
    const leaseToken = crypto.randomUUID();
    const claimedAt = new Date(nowMs).toISOString();
    const result = await database.prepare(`UPDATE ${deliveries}
      SET status = 'pending', attempt_count = attempt_count + 1,
          lease_token = ?, lease_until = ?, updated_at = ?
      WHERE id = ?
        AND status IN ('pending', 'failed')
        AND next_attempt_at <= ?
        AND (lease_until IS NULL OR lease_until <= ?)
        AND attempt_count < ?`)
      .bind(
        leaseToken,
        nowMs + DELIVERY_LEASE_MS,
        claimedAt,
        candidate.id,
        nowMs,
        nowMs,
        MAX_DELIVERY_ATTEMPTS,
      )
      .run();
    if ((result.meta.changes ?? 0) !== 1) continue;
    const accountQuery = `SELECT
        deliveries.id AS delivery_id,
        deliveries.game_id,
        deliveries.game_version,
        deliveries.attempt_count,
        deliveries.created_at,
        deliveries.lease_token,
        devices.id,
        devices.endpoint,
        devices.p256dh,
        devices.auth,
        devices.expiration_time,
        memberships.color AS target_color,
        devices.disabled_at AS target_disabled_at,
        games.status AS game_status,
        games.version AS current_version,
        games.turn_color AS current_turn,
        games.updated_at AS game_updated_at,
        settings.turn_pace_days
      FROM push_turn_deliveries AS deliveries
      JOIN push_devices AS devices ON devices.id = deliveries.device_id
      JOIN game_memberships AS memberships
        ON memberships.game_id = deliveries.game_id
        AND memberships.account_id = devices.account_id
      JOIN games ON games.id = deliveries.game_id
      LEFT JOIN game_settings AS settings ON settings.game_id = games.id
      WHERE deliveries.id = ? AND deliveries.lease_token = ?`;
    const legacyQuery = `SELECT
        deliveries.id AS delivery_id,
        deliveries.game_id,
        deliveries.game_version,
        deliveries.attempt_count,
        deliveries.created_at,
        deliveries.lease_token,
        subscriptions.id,
        subscriptions.endpoint,
        subscriptions.p256dh,
        subscriptions.auth,
        subscriptions.expiration_time,
        subscriptions.color AS target_color,
        subscriptions.disabled_at AS target_disabled_at,
        games.status AS game_status,
        games.version AS current_version,
        games.turn_color AS current_turn,
        games.updated_at AS game_updated_at,
        settings.turn_pace_days
      FROM push_deliveries AS deliveries
      JOIN push_subscriptions AS subscriptions
        ON subscriptions.id = deliveries.subscription_id
      JOIN game_memberships AS memberships
        ON memberships.game_id = subscriptions.game_id
        AND memberships.color = subscriptions.color
        AND memberships.account_id = subscriptions.account_id
      JOIN games ON games.id = deliveries.game_id
      LEFT JOIN game_settings AS settings ON settings.game_id = games.id
      WHERE deliveries.id = ? AND deliveries.lease_token = ?`;
    const claimed = await database.prepare(
      source === "account" ? accountQuery : legacyQuery,
    )
      .bind(candidate.id, leaseToken)
      .first<Omit<ClaimedPushDelivery, "source">>();
    if (claimed) return { ...claimed, source };
  }
  return null;
}

async function finalizeDelivery(
  delivery: ClaimedPushDelivery,
  status: "sent" | "stale" | "dead" | "superseded",
  statusCode: number | null,
): Promise<void> {
  const deliveries = delivery.source === "account"
    ? "push_turn_deliveries"
    : "push_deliveries";
  await getDatabase().prepare(`UPDATE ${deliveries}
    SET status = ?, status_code = ?, lease_token = NULL, lease_until = NULL,
        updated_at = ?
    WHERE id = ? AND lease_token = ?`)
    .bind(
      status,
      statusCode,
      new Date().toISOString(),
      delivery.delivery_id,
      delivery.lease_token,
    )
    .run();
}

async function retryDelivery(
  delivery: ClaimedPushDelivery,
  statusCode: number | null,
): Promise<"failed" | "dead"> {
  const nowMs = Date.now();
  const exhausted = delivery.attempt_count >= MAX_DELIVERY_ATTEMPTS
    || Date.parse(delivery.created_at) < nowMs - DELIVERY_MAX_AGE_MS;
  if (exhausted) {
    await finalizeDelivery(delivery, "dead", statusCode);
    return "dead";
  }
  const retryDelay = DELIVERY_RETRY_DELAYS_MS[Math.min(
    delivery.attempt_count - 1,
    DELIVERY_RETRY_DELAYS_MS.length - 1,
  )];
  const deliveries = delivery.source === "account"
    ? "push_turn_deliveries"
    : "push_deliveries";
  await getDatabase().prepare(`UPDATE ${deliveries}
    SET status = 'failed', status_code = ?, next_attempt_at = ?,
        lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE id = ? AND lease_token = ?`)
    .bind(
      statusCode,
      nowMs + retryDelay,
      new Date(nowMs).toISOString(),
      delivery.delivery_id,
      delivery.lease_token,
    )
    .run();
  return "failed";
}

async function sendClaimedTurnPush(
  delivery: ClaimedPushDelivery,
  config: PushRuntimeConfig,
): Promise<"sent" | "failed" | "stale" | "dead" | "superseded"> {
  if (
    delivery.target_disabled_at
    || (delivery.expiration_time !== null && delivery.expiration_time <= Date.now())
  ) {
    await finalizeDelivery(delivery, "dead", null);
    return "dead";
  }
  if (
    delivery.game_status !== "active"
    || delivery.current_version !== delivery.game_version
    || delivery.current_turn !== delivery.target_color
    || (delivery.turn_pace_days !== null
      && turnDeadlineExpired(
        delivery.game_updated_at,
        delivery.turn_pace_days,
      ))
  ) {
    await finalizeDelivery(delivery, "superseded", null);
    return "superseded";
  }
  try {
    const target: PushSubscription = {
      endpoint: delivery.endpoint,
      keys: { p256dh: delivery.p256dh, auth: delivery.auth },
    };
    const request = await generateRequestDetails(
      target,
      JSON.stringify({
        type: "your_turn",
        gameId: delivery.game_id,
        gameVersion: delivery.game_version,
      }),
      {
        vapidDetails: {
          publicKey: config.publicKey,
          privateKey: config.privateJwk.d!,
          subject: config.subject,
        },
        TTL: 24 * 60 * 60,
        urgency: "high",
        topic: await opaquePushTopic(delivery.game_id),
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
      const targets = delivery.source === "account" ? "push_devices" : "push_subscriptions";
      try {
        await getDatabase().prepare(`UPDATE ${targets}
          SET last_success_at = ?, failure_count = 0
          WHERE id = ? AND endpoint = ? AND p256dh = ? AND auth = ?
            AND disabled_at IS NULL`)
          .bind(
            now,
            delivery.id,
            delivery.endpoint,
            delivery.p256dh,
            delivery.auth,
          )
          .run();
      } catch {
        // Provider acceptance must not be retried because optional target metadata failed.
      }
      await finalizeDelivery(delivery, "sent", response.status);
      return "sent";
    }
    if (response.status === 404 || response.status === 410) {
      if (!await disableGloballyStalePushTarget(delivery, delivery.source)) {
        return retryDelivery(delivery, response.status);
      }
      await finalizeDelivery(delivery, "stale", response.status);
      return "stale";
    }
    const endpointFailure = response.status >= 400
      && response.status < 500
      && ![401, 403, 408, 425, 429].includes(response.status);
    if (endpointFailure) {
      const targets = delivery.source === "account" ? "push_devices" : "push_subscriptions";
      const changed = await getDatabase().prepare(`UPDATE ${targets}
        SET failure_count = failure_count + 1,
            disabled_at = CASE WHEN failure_count + 1 >= 3 THEN ? ELSE disabled_at END
        WHERE id = ? AND endpoint = ? AND p256dh = ? AND auth = ?`)
        .bind(
          new Date().toISOString(),
          delivery.id,
          delivery.endpoint,
          delivery.p256dh,
          delivery.auth,
        )
        .run();
      if ((changed.meta.changes ?? 0) !== 1) {
        return retryDelivery(delivery, response.status);
      }
    }
    return retryDelivery(delivery, response.status);
  } catch {
    return retryDelivery(delivery, null);
  }
}

async function claimAccountDelivery(nowMs: number): Promise<ClaimedAccountDelivery | null> {
  const database = getDatabase();
  for (let pass = 0; pass < 3; pass += 1) {
    const candidate = await database.prepare(`SELECT id
      FROM push_account_deliveries
      WHERE status IN ('pending', 'failed')
        AND next_attempt_at <= ?
        AND (lease_until IS NULL OR lease_until <= ?)
        AND attempt_count < ?
        AND created_at >= ?
      ORDER BY CASE WHEN attempt_count = 0 THEN 0 ELSE 1 END,
        next_attempt_at ASC, created_at ASC, id ASC
      LIMIT 1`)
      .bind(
        nowMs,
        nowMs,
        MAX_DELIVERY_ATTEMPTS,
        new Date(nowMs - DELIVERY_MAX_AGE_MS).toISOString(),
      )
      .first<{ id: string }>();
    if (!candidate) return null;
    const leaseToken = crypto.randomUUID();
    const claimedAt = new Date(nowMs).toISOString();
    const claimed = await database.prepare(`UPDATE push_account_deliveries
      SET status = 'pending', attempt_count = attempt_count + 1,
          lease_token = ?, lease_until = ?, updated_at = ?
      WHERE id = ?
        AND status IN ('pending', 'failed')
        AND next_attempt_at <= ?
        AND (lease_until IS NULL OR lease_until <= ?)
        AND attempt_count < ?`)
      .bind(
        leaseToken,
        nowMs + DELIVERY_LEASE_MS,
        claimedAt,
        candidate.id,
        nowMs,
        nowMs,
        MAX_DELIVERY_ATTEMPTS,
      )
      .run();
    if ((claimed.meta.changes ?? 0) !== 1) continue;
    const delivery = await database.prepare(`SELECT
        deliveries.id AS delivery_id,
        deliveries.friend_request_id,
        deliveries.attempt_count,
        deliveries.created_at,
        deliveries.lease_token,
        devices.id,
        devices.endpoint,
        devices.p256dh,
        devices.auth,
        devices.expiration_time,
        devices.disabled_at AS target_disabled_at,
        devices.account_id AS device_account_id,
        requests.recipient_account_id,
        requests.status AS request_status,
        sender.username AS sender_username,
        EXISTS (
          SELECT 1 FROM account_blocks AS blocks
          WHERE (blocks.blocker_account_id = requests.sender_account_id
              AND blocks.blocked_account_id = requests.recipient_account_id)
             OR (blocks.blocker_account_id = requests.recipient_account_id
              AND blocks.blocked_account_id = requests.sender_account_id)
        ) AS blocked
      FROM push_account_deliveries AS deliveries
      JOIN push_devices AS devices ON devices.id = deliveries.device_id
      JOIN friend_requests AS requests ON requests.id = deliveries.friend_request_id
      JOIN accounts AS sender ON sender.id = requests.sender_account_id
      WHERE deliveries.id = ? AND deliveries.lease_token = ?`)
      .bind(candidate.id, leaseToken)
      .first<ClaimedAccountDelivery>();
    if (delivery) return delivery;
  }
  return null;
}

async function finalizeAccountDelivery(
  delivery: ClaimedAccountDelivery,
  status: "sent" | "stale" | "dead" | "superseded",
): Promise<void> {
  await getDatabase().prepare(`UPDATE push_account_deliveries
    SET status = ?, lease_token = NULL, lease_until = NULL, updated_at = ?
    WHERE id = ? AND lease_token = ?`)
    .bind(
      status,
      new Date().toISOString(),
      delivery.delivery_id,
      delivery.lease_token,
    )
    .run();
}

async function retryAccountDelivery(
  delivery: ClaimedAccountDelivery,
): Promise<"failed" | "dead"> {
  const nowMs = Date.now();
  const exhausted = delivery.attempt_count >= MAX_DELIVERY_ATTEMPTS
    || Date.parse(delivery.created_at) < nowMs - DELIVERY_MAX_AGE_MS;
  if (exhausted) {
    await finalizeAccountDelivery(delivery, "dead");
    return "dead";
  }
  const retryDelay = DELIVERY_RETRY_DELAYS_MS[Math.min(
    delivery.attempt_count - 1,
    DELIVERY_RETRY_DELAYS_MS.length - 1,
  )];
  await getDatabase().prepare(`UPDATE push_account_deliveries
    SET status = 'failed', next_attempt_at = ?, lease_token = NULL,
        lease_until = NULL, updated_at = ?
    WHERE id = ? AND lease_token = ?`)
    .bind(
      nowMs + retryDelay,
      new Date(nowMs).toISOString(),
      delivery.delivery_id,
      delivery.lease_token,
    )
    .run();
  return "failed";
}

async function sendClaimedAccountPush(
  delivery: ClaimedAccountDelivery,
  config: PushRuntimeConfig,
): Promise<{
  status: "sent" | "failed" | "stale" | "dead" | "superseded";
  provider: PushServiceDeviceOutcome | null;
}> {
  if (
    delivery.target_disabled_at
    || (delivery.expiration_time !== null && delivery.expiration_time <= Date.now())
  ) {
    await finalizeAccountDelivery(delivery, "dead");
    return { status: "dead", provider: null };
  }
  if (
    delivery.device_account_id !== delivery.recipient_account_id
    || delivery.request_status !== "pending"
    || delivery.blocked === 1
  ) {
    await finalizeAccountDelivery(delivery, "superseded");
    return { status: "superseded", provider: null };
  }
  const provider = await sendPushPayloadToDevice(
    delivery,
    {
      type: "friend_request",
      senderUsername: delivery.sender_username,
      requestId: delivery.friend_request_id,
    },
    config,
    {
      ttl: 24 * 60 * 60,
      urgency: "high",
      topic: await servicePushTopic(`friend-request:${delivery.friend_request_id}`),
    },
  );
  if (provider === "accepted") {
    await finalizeAccountDelivery(delivery, "sent");
    return { status: "sent", provider };
  }
  if (provider === "stale") {
    await finalizeAccountDelivery(delivery, "stale");
    return { status: "stale", provider };
  }
  return { status: await retryAccountDelivery(delivery), provider };
}

export async function drainPendingAccountNotifications(
  limit = MAX_DEVICES_PER_ACCOUNT,
): Promise<PushDrainResult> {
  await ensureSchema();
  const nowMs = Date.now();
  const reapedDead = await expireUndeliverableRows("push_account_deliveries", nowMs);
  const pendingAt = await nextDeliveryAttempt("account", nowMs);
  if (pendingAt === null || pendingAt > nowMs) {
    if (reapedDead > 0) {
      await recordEvent({
        event: "push.account_delivery",
        outcome: "failure",
        errorCode: "push_delivery_exhausted",
        metadata: { attempted: 0, reapedDead },
      });
    }
    return { attempted: 0, failed: 0, hasMore: false, nextAttemptAt: pendingAt };
  }
  const config = await runtimeConfig();
  if (!config) {
    await recordEvent({
      event: "push.account_delivery",
      outcome: "failure",
      errorCode: "push_configuration_invalid",
    });
    return { attempted: 0, failed: 0, hasMore: false, nextAttemptAt: null };
  }
  const counts = { sent: 0, failed: 0, stale: 0, dead: 0, superseded: 0 };
  const providerCounts = {
    accepted: 0,
    providerAuth: 0,
    retryable: 0,
    endpointRejected: 0,
  };
  const boundedLimit = Math.max(1, Math.min(MAX_DEVICES_PER_ACCOUNT, Math.floor(limit)));
  for (let index = 0; index < boundedLimit; index += 1) {
    const delivery = await claimAccountDelivery(Date.now());
    if (!delivery) break;
    const result = await sendClaimedAccountPush(delivery, config);
    counts[result.status] += 1;
    if (result.provider === "accepted") providerCounts.accepted += 1;
    else if (result.provider === "provider_auth") providerCounts.providerAuth += 1;
    else if (result.provider === "retryable") providerCounts.retryable += 1;
    else if (result.provider === "endpoint_rejected") providerCounts.endpointRejected += 1;
  }
  const attempted = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const nextAttemptAt = await nextDeliveryAttempt("account", Date.now());
  const hasMore = nextAttemptAt !== null && nextAttemptAt <= Date.now();
  if (attempted === 0) return { attempted: 0, failed: 0, hasMore, nextAttemptAt };
  await recordEvent({
    event: "push.account_delivery",
    outcome: counts.failed > 0 && counts.sent === 0 ? "failure" : "success",
    metadata: { attempted, reapedDead, ...counts, ...providerCounts },
  });
  return { attempted, failed: counts.failed, hasMore, nextAttemptAt };
}

export async function drainPendingTurnNotifications(
  limit = MAX_DELIVERIES_PER_DRAIN,
): Promise<PushDrainResult> {
  await ensureSchema();
  const nowMs = Date.now();
  const reapedDead = (
    await expireUndeliverableRows("push_turn_deliveries", nowMs)
  ) + (
    await expireUndeliverableRows("push_deliveries", nowMs)
  );
  const pendingAt = await nextDeliveryAttempt("turn", nowMs);
  if (pendingAt === null || pendingAt > nowMs) {
    if (reapedDead > 0) {
      await recordEvent({
        event: "push.turn_delivery",
        outcome: "failure",
        errorCode: "push_delivery_exhausted",
        metadata: { attempted: 0, reapedDead },
      });
    }
    return { attempted: 0, failed: 0, hasMore: false, nextAttemptAt: pendingAt };
  }
  const config = await runtimeConfig();
  if (!config) {
    await recordEvent({
      event: "push.turn_delivery",
      outcome: "failure",
      errorCode: "push_configuration_invalid",
    });
    return { attempted: 0, failed: 0, hasMore: false, nextAttemptAt: null };
  }
  const counts = { sent: 0, failed: 0, stale: 0, dead: 0, superseded: 0 };
  const boundedLimit = Math.max(1, Math.min(MAX_DELIVERIES_PER_DRAIN, Math.floor(limit)));
  for (let index = 0; index < boundedLimit; index += 1) {
    const delivery = await claimDelivery(Date.now());
    if (!delivery) break;
    const outcome = await sendClaimedTurnPush(delivery, config);
    counts[outcome] += 1;
  }
  const attempted = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const nextAttemptAt = await nextDeliveryAttempt("turn", Date.now());
  const hasMore = nextAttemptAt !== null && nextAttemptAt <= Date.now();
  if (attempted === 0) return { attempted: 0, failed: 0, hasMore, nextAttemptAt };
  await recordEvent({
    event: "push.turn_delivery",
    outcome: counts.failed > 0 && counts.sent === 0 ? "failure" : "success",
    metadata: { attempted, reapedDead, ...counts },
  });
  return { attempted, failed: counts.failed, hasMore, nextAttemptAt };
}
