import type {
  AiDifficulty,
  GameMode,
  TurnPaceDays,
} from "./game-types";

export const GAME_CREATE_INTENT_LEASE_MS = 30_000;

export interface GameCreateFingerprintInput {
  accountId: string;
  displayName: string;
  playerHash: string;
  inviteHash: string;
  mode: GameMode;
  difficulty: AiDifficulty | null;
  turnPaceDays: TurnPaceDays | null;
  magicPrompt: string | null;
}

interface GameCreateIntentRow {
  fingerprint: string;
  lease_token: string;
  lease_until: number;
}

interface GameCreateIntentDependencies {
  now?: () => number;
  randomUuid?: () => string;
}

export type GameCreateIntentAcquisition =
  | {
    status: "acquired";
    leaseToken: string;
  }
  | {
    status: "pending";
    retryAfter: number;
  }
  | {
    status: "conflict";
  }
  | {
    status: "completed";
  };

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
}

export async function gameCreateFingerprint(
  input: GameCreateFingerprintInput,
): Promise<string> {
  const canonical = JSON.stringify([
    "game-create-intent-v1",
    input.accountId,
    input.displayName,
    input.playerHash,
    input.inviteHash,
    input.mode,
    input.difficulty,
    input.turnPaceDays,
    input.magicPrompt,
  ]);
  return hex(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  ));
}

async function readIntent(
  db: D1Database,
  requestId: string,
): Promise<GameCreateIntentRow | null> {
  return await db
    .prepare(`SELECT fingerprint, lease_token, lease_until
      FROM game_create_intents WHERE request_id = ?`)
    .bind(requestId)
    .first<GameCreateIntentRow>();
}

export async function acquireGameCreateIntent(
  db: D1Database,
  requestId: string,
  fingerprint: string,
  dependencies: GameCreateIntentDependencies = {},
): Promise<GameCreateIntentAcquisition> {
  const now = (dependencies.now ?? Date.now)();
  const leaseToken = dependencies.randomUuid
    ? dependencies.randomUuid()
    : crypto.randomUUID();
  const leaseUntil = now + GAME_CREATE_INTENT_LEASE_MS;
  const timestamp = new Date(now).toISOString();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const acquired = await db
      .prepare(`INSERT INTO game_create_intents (
        request_id, fingerprint, lease_token, lease_until, created_at, updated_at
      ) SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM games WHERE create_request_id = ?
      )
      ON CONFLICT(request_id) DO UPDATE SET
        lease_token = excluded.lease_token,
        lease_until = excluded.lease_until,
        updated_at = excluded.updated_at
      WHERE game_create_intents.fingerprint = excluded.fingerprint
        AND game_create_intents.lease_until <= ?
      RETURNING fingerprint, lease_token, lease_until`)
      .bind(
        requestId,
        fingerprint,
        leaseToken,
        leaseUntil,
        timestamp,
        timestamp,
        requestId,
        now,
      )
      .first<GameCreateIntentRow>();
    if (acquired?.lease_token === leaseToken) {
      return { status: "acquired", leaseToken };
    }

    const completed = await db
      .prepare("SELECT 1 AS present FROM games WHERE create_request_id = ?")
      .bind(requestId)
      .first<{ present: number }>();
    if (completed) return { status: "completed" };
    const current = await readIntent(db, requestId);
    if (!current) continue;
    if (current.fingerprint !== fingerprint) return { status: "conflict" };
    return {
      status: "pending",
      retryAfter: Math.max(1, Math.ceil((current.lease_until - now) / 1_000)),
    };
  }

  return { status: "pending", retryAfter: 1 };
}

export async function releaseGameCreateIntent(
  db: D1Database,
  requestId: string,
  fingerprint: string,
  leaseToken: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM game_create_intents
      WHERE request_id = ? AND fingerprint = ? AND lease_token = ?`)
    .bind(requestId, fingerprint, leaseToken)
    .run();
  return (result.meta.changes ?? 0) === 1;
}
