import { ensureSchema, getDatabase } from "../db";
import type { Color, GameMode, Termination } from "./game-types";
import {
  verifiedRequestAccount,
  type PlayerAccount,
} from "./account-auth";

export interface AccountGameSummary {
  id: string;
  mode: GameMode;
  status: "waiting" | "active" | "completed";
  color: Color;
  opponent: string | null;
  turn: Color;
  plyCount: number;
  isMagic: boolean;
  updatedAt: string;
  outcome: { winner: Color | null; reason: Termination } | null;
}

export interface AccountGamesPage {
  games: AccountGameSummary[];
  nextCursor: string | null;
}

export type AccountGamesView = "all" | "watch";

export interface AccountGamesCursor {
  updatedAt: string;
  id: string;
}

const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 50;
const WATCH_WINDOW_MS = 24 * 60 * 60 * 1_000;

function encodeCursor(cursor: AccountGamesCursor): string {
  return btoa(JSON.stringify(cursor))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function parseAccountGamesCursor(value: string | null): AccountGamesCursor | null {
  if (!value || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as Partial<AccountGamesCursor>;
    if (
      typeof parsed.updatedAt !== "string"
      || !Number.isFinite(Date.parse(parsed.updatedAt))
      || typeof parsed.id !== "string"
      || !/^[0-9a-f-]{36}$/i.test(parsed.id)
    ) return null;
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    return null;
  }
}

export async function upsertAccount(account: PlayerAccount): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await getDatabase()
    .prepare(`INSERT INTO accounts (id, display_name, created_at, last_seen_at, last_captcha_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        last_seen_at = excluded.last_seen_at`)
    .bind(account.id, account.displayName, now, now, now)
    .run();
}

export async function requireApiAccount(
  request: Request,
): Promise<PlayerAccount | null> {
  const account = await verifiedRequestAccount(request);
  if (!account) return null;
  await upsertAccount(account);
  return account;
}

export async function enforceAccountRateLimit(
  accountId: string,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; retryAfter: number }> {
  await ensureSchema();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds;
  const expiresAt = windowStart + windowSeconds;
  const key = `${accountId}:${scope}:${windowStart}`;
  const row = await getDatabase()
    .prepare(`INSERT INTO rate_limit_windows (
        key, account_id, scope, window_start, hit_count, expires_at
      ) VALUES (?, ?, ?, ?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET hit_count = rate_limit_windows.hit_count + 1
      RETURNING hit_count`)
    .bind(key, accountId, scope, windowStart, expiresAt)
    .first<{ hit_count: number }>();
  return {
    allowed: Boolean(row && row.hit_count <= limit),
    retryAfter: Math.max(1, expiresAt - nowSeconds),
  };
}

export async function listAccountGames(
  accountId: string,
  options: {
    cursor?: AccountGamesCursor | null;
    limit?: number;
    view?: AccountGamesView;
  } = {},
): Promise<AccountGamesPage> {
  await ensureSchema();
  const limit = Number.isInteger(options.limit)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Number(options.limit)))
    : DEFAULT_PAGE_SIZE;
  const conditions = ["game_memberships.account_id = ?"];
  const bindings: Array<string | number> = [accountId];
  if (options.view === "watch") {
    conditions.push("(games.status <> 'completed' OR games.updated_at >= ?)");
    bindings.push(new Date(Date.now() - WATCH_WINDOW_MS).toISOString());
  }
  if (options.cursor) {
    conditions.push(
      "(games.updated_at < ? OR (games.updated_at = ? AND games.id < ?))",
    );
    bindings.push(
      options.cursor.updatedAt,
      options.cursor.updatedAt,
      options.cursor.id,
    );
  }
  const result = await getDatabase()
    .prepare(`SELECT
        games.id,
        games.status,
        games.turn_color,
        games.ply_count,
        games.winner_color,
        games.termination,
        games.updated_at,
        game_settings.game_mode,
        CASE WHEN game_settings.magic_rules_json IS NULL THEN 0 ELSE 1 END AS is_magic,
        game_memberships.color,
        CASE
          WHEN game_memberships.color = 'w' THEN games.black_name
          ELSE games.white_name
        END AS opponent
      FROM game_memberships
      JOIN games ON games.id = game_memberships.game_id
      JOIN game_settings ON game_settings.game_id = games.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY games.updated_at DESC, games.id DESC
      LIMIT ?`)
    .bind(...bindings, limit + 1)
    .all<{
      id: string;
      status: "waiting" | "active" | "completed";
      turn_color: Color;
      ply_count: number;
      winner_color: Color | null;
      termination: Termination | null;
      updated_at: string;
      game_mode: GameMode;
      is_magic: number;
      color: Color;
      opponent: string | null;
    }>();
  const rows = result.results ?? [];
  const pageRows = rows.slice(0, limit);
  const games = pageRows.map((row) => ({
    id: row.id,
    mode: row.game_mode,
    status: row.status,
    color: row.color,
    opponent: row.opponent,
    turn: row.turn_color,
    plyCount: row.ply_count,
    isMagic: row.is_magic === 1,
    updatedAt: row.updated_at,
    outcome: row.termination
      ? { winner: row.winner_color, reason: row.termination }
      : null,
  }));
  const last = pageRows.at(-1);
  return {
    games,
    nextCursor: rows.length > limit && last
      ? encodeCursor({ updatedAt: last.updated_at, id: last.id })
      : null,
  };
}
