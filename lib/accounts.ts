import { ensureSchema, getDatabase } from "../db";
import type {
  Color,
  GameMode,
  Termination,
  TurnPaceDays,
} from "./game-types";
import {
  guestAccountForToken,
  verifiedAccountsFromHeaders,
  type PlayerAccount,
} from "./account-auth";
import { googleSessionAccountFromHeaders } from "./google-auth";
import {
  isGameVariantId,
  normalizeGameVariantId,
  type GameVariantId,
} from "./game-variants";
import { REFERRAL_CREDITS } from "./referral-constants";
import { creditBalance, STARTER_CREDITS } from "./credits";
import { canonicalUsername, validateUsername } from "./usernames";
import { expireAccountMultiplayerTurns } from "./game-store";

export interface AccountProfile extends PlayerAccount {
  username: string | null;
  usernameSetAt: string | null;
  tutorialStatus: "pending" | "completed" | "skipped";
}

export interface UsernameReferralReward {
  state: "rewarded";
  inviterUsername: string;
  creditsAwarded: number;
  creditBalance: number;
}

export type SetUsernameResult =
  | {
      ok: true;
      profile: AccountProfile;
      alreadySet: boolean;
      referral: UsernameReferralReward | null;
    }
  | { ok: false; code: "invalid" | "unavailable" | "already_set"; message: string };

export interface AccountGameSummary {
  id: string;
  mode: GameMode;
  variantId: GameVariantId;
  status: "waiting" | "active" | "completed";
  color: Color;
  opponent: string | null;
  turn: Color;
  turnPaceDays: TurnPaceDays | null;
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

export async function accountIsDeleted(accountId: string): Promise<boolean> {
  await ensureSchema();
  return Boolean(await getDatabase()
    .prepare("SELECT account_id FROM account_tombstones WHERE account_id = ?")
    .bind(accountId)
    .first<{ account_id: string }>());
}

export async function upsertAccount(account: PlayerAccount): Promise<boolean> {
  await ensureSchema();
  const now = new Date().toISOString();
  const database = getDatabase();
  await database.batch([
    database.prepare(`INSERT INTO accounts (
        id, display_name, tutorial_status, created_at, last_seen_at, last_captcha_at
      ) SELECT ?, ?, 'skipped', ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM account_tombstones WHERE account_id = ?
      )
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        last_seen_at = excluded.last_seen_at
      WHERE NOT EXISTS (
        SELECT 1 FROM account_tombstones WHERE account_id = excluded.id
      )`)
      .bind(account.id, account.displayName, now, now, now, account.id),
    database.prepare(`INSERT OR IGNORE INTO account_credit_ledger (
        id, account_id, amount, reason, source_key, created_at
      ) SELECT ?, ?, ?, 'starter', ?, ?
        WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ?)`)
      .bind(
        `starter:${account.id}`,
        account.id,
        STARTER_CREDITS,
        `starter:${account.id}`,
        now,
        account.id,
      ),
  ]);
  const row = await database.prepare(`SELECT
      EXISTS(SELECT 1 FROM accounts WHERE id = ?) AS active,
      EXISTS(SELECT 1 FROM account_tombstones WHERE account_id = ?) AS deleted`)
    .bind(account.id, account.id)
    .first<{ active: number; deleted: number }>();
  return row?.active === 1 && row.deleted !== 1;
}

export async function getAccountProfile(accountId: string): Promise<AccountProfile | null> {
  await ensureSchema();
  const row = await getDatabase()
    .prepare(`SELECT id, display_name, username, username_set_at, tutorial_status
      FROM accounts WHERE id = ?`)
    .bind(accountId)
    .first<{
      id: string;
      display_name: string;
      username: string | null;
      username_set_at: string | null;
      tutorial_status: "pending" | "completed" | "skipped";
    }>();
  return row ? {
    id: row.id,
    displayName: row.display_name,
    username: row.username,
    usernameSetAt: row.username_set_at,
    tutorialStatus: row.tutorial_status,
  } : null;
}

export async function requireGoogleApiAccount(
  request: Request,
): Promise<AccountProfile | null> {
  const account = await googleSessionAccountFromHeaders(request.headers);
  if (!account) return null;
  if (!(await upsertAccount(account))) return null;
  return getAccountProfile(account.id);
}

export async function setUsernameOnce(
  accountId: string,
  value: unknown,
): Promise<SetUsernameResult> {
  const validated = validateUsername(value);
  if (!validated.ok) {
    return {
      ok: false,
      code: "invalid",
      message: validated.message,
    };
  }
  await ensureSchema();
  const current = await getAccountProfile(accountId);
  if (!current) {
    return { ok: false, code: "invalid", message: "Account not found." };
  }
  if (current.username) {
    if (canonicalUsername(current.username) === validated.canonical) {
      return { ok: true, profile: current, alreadySet: true, referral: null };
    }
    return {
      ok: false,
      code: "already_set",
      message: "Your username was chosen already and cannot be changed.",
    };
  }
  const reserved = await getDatabase()
    .prepare("SELECT account_id FROM account_tombstones WHERE username_canonical = ?")
    .bind(validated.canonical)
    .first<{ account_id: string }>();
  if (reserved) {
    return {
      ok: false,
      code: "unavailable",
      message: "That username is unavailable. Try another.",
    };
  }
  const now = new Date().toISOString();
  const database = getDatabase();
  const pendingReferral = await database
    .prepare(`SELECT attributions.referrer_account_id, accounts.username AS inviter_username
      FROM referral_attributions AS attributions
      JOIN accounts ON accounts.id = attributions.referrer_account_id
      WHERE attributions.referred_account_id = ?
        AND attributions.status = 'pending'
        AND accounts.username IS NOT NULL`)
    .bind(accountId)
    .first<{ referrer_account_id: string; inviter_username: string }>();
  try {
    const statements = [
      database.prepare(`UPDATE accounts
        SET username = ?, username_canonical = ?, username_set_at = ?
        WHERE id = ? AND username IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM account_tombstones
            WHERE username_canonical = ?
          )`)
        .bind(
          validated.username,
          validated.canonical,
          now,
          accountId,
          validated.canonical,
        ),
    ];
    if (pendingReferral) {
      const pairKey = [accountId, pendingReferral.referrer_account_id].sort().join(":");
      statements.push(
        database
          .prepare(`UPDATE referral_attributions
            SET status = 'rewarded', credits = ?, completed_at = ?
            WHERE referred_account_id = ?
              AND status = 'pending'
              AND changes() = 1`)
          .bind(REFERRAL_CREDITS, now, accountId),
        database
          .prepare(`INSERT INTO friend_requests (
            id, pair_key, sender_account_id, recipient_account_id,
            status, created_at, responded_at
          ) SELECT ?, ?, ?, ?, 'accepted', ?, ?
          WHERE changes() = 1
          ON CONFLICT(pair_key) DO UPDATE SET
            status = 'accepted',
            responded_at = excluded.responded_at`)
          .bind(
            crypto.randomUUID(),
            pairKey,
            pendingReferral.referrer_account_id,
            accountId,
            now,
            now,
          ),
        database
          .prepare(`INSERT OR IGNORE INTO account_credit_ledger (
            id, account_id, amount, reason, source_key, created_at
          ) SELECT ?, ?, ?, 'referral', ?, ?
          WHERE EXISTS (
            SELECT 1 FROM referral_attributions
            WHERE referred_account_id = ?
              AND referrer_account_id = ?
              AND status = 'rewarded'
          )`)
          .bind(
            `referral:${accountId}`,
            pendingReferral.referrer_account_id,
            REFERRAL_CREDITS,
            `referral:${accountId}`,
            now,
            accountId,
            pendingReferral.referrer_account_id,
          ),
      );
    }
    const results = await database.batch(statements);
    const result = results[0];
    if ((result.meta.changes ?? 0) === 1) {
      const profile = await getAccountProfile(accountId);
      if (profile) {
        let referral: UsernameReferralReward | null = null;
        if (pendingReferral && (results[1]?.meta.changes ?? 0) === 1) {
          const balance = await creditBalance(pendingReferral.referrer_account_id);
          referral = {
            state: "rewarded",
            inviterUsername: pendingReferral.inviter_username,
            creditsAwarded: REFERRAL_CREDITS,
            creditBalance: balance,
          };
        }
        return { ok: true, profile, alreadySet: false, referral };
      }
    }
  } catch (error) {
    const taken = await getDatabase()
      .prepare("SELECT id FROM accounts WHERE username_canonical = ?")
      .bind(validated.canonical)
      .first<{ id: string }>();
    if (taken && taken.id !== accountId) {
      return {
        ok: false,
        code: "unavailable",
        message: "That username is taken. Try another.",
      };
    }
    throw error;
  }
  const settled = await getAccountProfile(accountId);
  if (settled?.username) {
    return canonicalUsername(settled.username) === validated.canonical
      ? { ok: true, profile: settled, alreadySet: true, referral: null }
      : {
          ok: false,
          code: "already_set",
          message: "Your username was chosen already and cannot be changed.",
        };
  }
  return {
    ok: false,
    code: "unavailable",
    message: "That username is taken. Try another.",
  };
}

export async function findAccountByUsername(
  username: string,
): Promise<AccountProfile | null> {
  const validated = validateUsername(username);
  if (!validated.ok) return null;
  await ensureSchema();
  const row = await getDatabase()
    .prepare(`SELECT id, display_name, username, username_set_at, tutorial_status
      FROM accounts WHERE username_canonical = ?`)
    .bind(validated.canonical)
    .first<{
      id: string;
      display_name: string;
      username: string | null;
      username_set_at: string | null;
      tutorial_status: "pending" | "completed" | "skipped";
    }>();
  return row ? {
    id: row.id,
    displayName: row.display_name,
    username: row.username,
    usernameSetAt: row.username_set_at,
    tutorialStatus: row.tutorial_status,
  } : null;
}

export async function setTutorialStatus(
  accountId: string,
  status: "pending" | "completed" | "skipped",
): Promise<boolean> {
  await ensureSchema();
  const result = await getDatabase()
    .prepare("UPDATE accounts SET tutorial_status = ? WHERE id = ?")
    .bind(status, accountId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function requireApiAccount(
  request: Request,
): Promise<PlayerAccount | null> {
  return (await requireApiAccounts(request))[0] ?? null;
}

export async function requireApiAccounts(
  request: Request,
): Promise<PlayerAccount[]> {
  const accounts = await verifiedAccountsFromHeaders(request.headers);
  const active: PlayerAccount[] = [];
  for (const account of accounts) {
    if (await upsertAccount(account)) active.push(account);
  }
  return active;
}

export async function resolveGuestApiAccount(
  guest: { token: string; displayName: string },
): Promise<PlayerAccount> {
  const account = await guestAccountForToken(guest.token, guest.displayName);
  await upsertAccount(account);
  return account;
}

export async function resolveApiAccount(
  request: Request,
  guest: { token: string; displayName: string },
): Promise<PlayerAccount> {
  const account = await googleSessionAccountFromHeaders(request.headers);
  if (account) {
    await upsertAccount(account);
    return account;
  }
  return resolveGuestApiAccount(guest);
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
  const database = getDatabase();
  await database
    .prepare("DELETE FROM rate_limit_windows WHERE expires_at < ?")
    .bind(nowSeconds)
    .run();
  const row = await database
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
  accountId: string | string[],
  options: {
    cursor?: AccountGamesCursor | null;
    limit?: number;
    view?: AccountGamesView;
    mode?: GameMode | null;
    variantId?: GameVariantId | null;
    magic?: boolean | null;
  } = {},
): Promise<AccountGamesPage> {
  await expireAccountMultiplayerTurns(accountId);
  await ensureSchema();
  const accountIds = [...new Set(
    (Array.isArray(accountId) ? accountId : [accountId]).filter(Boolean),
  )];
  if (!accountIds.length) return { games: [], nextCursor: null };
  const limit = Number.isInteger(options.limit)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Number(options.limit)))
    : DEFAULT_PAGE_SIZE;
  const conditions = [
    `game_memberships.account_id IN (${accountIds.map(() => "?").join(",")})`,
  ];
  const bindings: Array<string | number> = [...accountIds];
  if (options.view === "watch") {
    conditions.push("(games.status <> 'completed' OR games.updated_at >= ?)");
    bindings.push(new Date(Date.now() - WATCH_WINDOW_MS).toISOString());
  }
  if (options.mode) {
    conditions.push("COALESCE(game_settings.game_mode, 'multiplayer') = ?");
    bindings.push(options.mode);
  }
  if (options.variantId && isGameVariantId(options.variantId)) {
    conditions.push("COALESCE(game_settings.variant_id, 'standard') = ?");
    bindings.push(options.variantId);
  }
  if (options.magic === true) conditions.push("game_settings.magic_rules_json IS NOT NULL");
  if (options.magic === false) conditions.push("game_settings.magic_rules_json IS NULL");
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
        COALESCE(game_settings.game_mode, 'multiplayer') AS game_mode,
        COALESCE(game_settings.variant_id, 'standard') AS variant_id,
        game_settings.turn_pace_days,
        CASE WHEN game_settings.magic_rules_json IS NULL THEN 0 ELSE 1 END AS is_magic,
        game_memberships.color,
        CASE
          WHEN game_memberships.color = 'w' THEN games.black_name
          ELSE games.white_name
        END AS opponent
      FROM game_memberships
      JOIN games ON games.id = game_memberships.game_id
      LEFT JOIN game_settings ON game_settings.game_id = games.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY games.updated_at DESC, games.id DESC,
        CASE game_memberships.account_id
          ${accountIds.map((_, index) => `WHEN ? THEN ${index}`).join(" ")}
          ELSE ${accountIds.length}
        END
      LIMIT ?`)
    .bind(...bindings, ...accountIds, (limit + 1) * accountIds.length)
    .all<{
      id: string;
      status: "waiting" | "active" | "completed";
      turn_color: Color;
      ply_count: number;
      winner_color: Color | null;
      termination: Termination | null;
      updated_at: string;
      game_mode: GameMode;
      variant_id: string;
      turn_pace_days: TurnPaceDays | null;
      is_magic: number;
      color: Color;
      opponent: string | null;
    }>();
  const rows = result.results ?? [];
  const seen = new Set<string>();
  const uniqueRows = rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  const pageRows = uniqueRows.slice(0, limit);
  const games = pageRows.map((row) => ({
    id: row.id,
    mode: row.game_mode,
    variantId: normalizeGameVariantId(row.variant_id),
    status: row.status,
    color: row.color,
    opponent: row.opponent,
    turn: row.turn_color,
    turnPaceDays: row.turn_pace_days,
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
    nextCursor: uniqueRows.length > limit && last
      ? encodeCursor({ updatedAt: last.updated_at, id: last.id })
      : null,
  };
}
