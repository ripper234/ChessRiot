import { ensureSchema, getDatabase } from "@/db";

export const MAGIC_RULES_FEATURE = "magic_rules";
export type RequestableFeatureKey = typeof MAGIC_RULES_FEATURE;
export type FeatureAccessState = "none" | "pending" | "enabled";

const REQUESTABLE_FEATURES = new Set<string>([MAGIC_RULES_FEATURE]);

export function isRequestableFeatureKey(value: unknown): value is RequestableFeatureKey {
  return typeof value === "string" && REQUESTABLE_FEATURES.has(value);
}

export interface FeatureAccessRequestState {
  feature: RequestableFeatureKey;
  status: FeatureAccessState;
  requestedAt: string | null;
}

export interface PendingFeatureAccessRequest {
  id: string;
  username: string;
  requestedAt: string;
}

export async function getFeatureAccessState(
  accountId: string,
  feature: RequestableFeatureKey,
): Promise<FeatureAccessRequestState> {
  await ensureSchema();
  const row = await getDatabase()
    .prepare(`SELECT
        EXISTS(
          SELECT 1 FROM account_feature_flags
          WHERE account_id = ? AND feature_key = ? AND enabled = 1
        ) AS enabled,
        (
          SELECT requested_at FROM feature_access_requests
          WHERE account_id = ? AND feature_key = ?
        ) AS requested_at`)
    .bind(accountId, feature, accountId, feature)
    .first<{ enabled: number; requested_at: string | null }>();
  if (row?.enabled === 1) {
    return { feature, status: "enabled", requestedAt: null };
  }
  return row?.requested_at
    ? { feature, status: "pending", requestedAt: row.requested_at }
    : { feature, status: "none", requestedAt: null };
}

export async function requestFeatureAccess(
  accountId: string,
  feature: RequestableFeatureKey,
): Promise<FeatureAccessRequestState & { created: boolean }> {
  await ensureSchema();
  const now = new Date().toISOString();
  const result = await getDatabase()
    .prepare(`INSERT OR IGNORE INTO feature_access_requests (
        id, account_id, feature_key, requested_at
      ) SELECT ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM account_feature_flags
        WHERE account_id = ? AND feature_key = ? AND enabled = 1
      )`)
    .bind(crypto.randomUUID(), accountId, feature, now, accountId, feature)
    .run();
  const state = await getFeatureAccessState(accountId, feature);
  if (state.status === "none") throw new Error("feature_access_request_not_persisted");
  return { ...state, created: (result.meta.changes ?? 0) === 1 };
}

export async function listPendingFeatureAccessRequests(
  feature: RequestableFeatureKey,
  limit = 100,
): Promise<{ pendingCount: number; requests: PendingFeatureAccessRequest[]; truncated: boolean }> {
  await ensureSchema();
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const database = getDatabase();
  const [count, rows] = await Promise.all([
    database.prepare(`SELECT COUNT(*) AS count
      FROM feature_access_requests WHERE feature_key = ?`)
      .bind(feature)
      .first<{ count: number }>(),
    database.prepare(`SELECT requests.id, accounts.username, requests.requested_at
      FROM feature_access_requests AS requests
      JOIN accounts ON accounts.id = requests.account_id
      WHERE requests.feature_key = ? AND accounts.username IS NOT NULL
      ORDER BY requests.requested_at ASC, requests.id ASC
      LIMIT ?`)
      .bind(feature, boundedLimit)
      .all<{ id: string; username: string; requested_at: string }>(),
  ]);
  const pendingCount = Number(count?.count ?? 0);
  return {
    pendingCount,
    requests: (rows.results ?? []).map((row) => ({
      id: row.id,
      username: row.username,
      requestedAt: row.requested_at,
    })),
    truncated: pendingCount > boundedLimit,
  };
}

export async function resolveFeatureAccessRequest(
  requestId: string,
  feature: RequestableFeatureKey,
  decision: "approve" | "dismiss",
): Promise<
  | { ok: true; username: string; decision: "approved" | "dismissed"; enabled: boolean }
  | { ok: false; code: "not_found" }
> {
  await ensureSchema();
  const database = getDatabase();
  const pending = await database
    .prepare(`SELECT accounts.username
      FROM feature_access_requests AS requests
      JOIN accounts ON accounts.id = requests.account_id
      WHERE requests.id = ? AND requests.feature_key = ?
        AND accounts.username IS NOT NULL`)
    .bind(requestId, feature)
    .first<{ username: string }>();
  if (!pending?.username) return { ok: false, code: "not_found" };

  const now = new Date().toISOString();
  if (decision === "dismiss") {
    const deleted = await database
      .prepare("DELETE FROM feature_access_requests WHERE id = ? AND feature_key = ?")
      .bind(requestId, feature)
      .run();
    return (deleted.meta.changes ?? 0) === 1
      ? { ok: true, username: pending.username, decision: "dismissed", enabled: false }
      : { ok: false, code: "not_found" };
  }

  const results = await database.batch([
    database.prepare(`INSERT INTO account_feature_flags (
        account_id, feature_key, enabled, updated_at
      ) SELECT account_id, feature_key, 1, ?
      FROM feature_access_requests WHERE id = ? AND feature_key = ?
      ON CONFLICT(account_id, feature_key) DO UPDATE SET
        enabled = 1,
        updated_at = excluded.updated_at`)
      .bind(now, requestId, feature),
    database.prepare("DELETE FROM feature_access_requests WHERE id = ? AND feature_key = ?")
      .bind(requestId, feature),
  ]);
  return (results[1]?.meta.changes ?? 0) === 1
    ? { ok: true, username: pending.username, decision: "approved", enabled: true }
    : { ok: false, code: "not_found" };
}
