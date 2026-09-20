import { Chess } from "chess.js";
import { ensureSchema, getDatabase } from "@/db";
import { turnDeadlineAt } from "./game-deadlines";
import { claimableDraws, replayWithRepetition } from "./game-rules";
import { gameClockSnapshot } from "./game-clocks";
import { parseMoveContinuation } from "./move-continuation";
import {
  parseStoredMagicRules,
  publicMagicRules,
  type CompiledMagicRules,
} from "./magic-rules";
import { displayMagicWorldCode } from "./magic-world-code";
import {
  normalizeGameVariantId,
  type GameVariantId,
} from "./game-variants";
import { recordEvent } from "./observability";
import type {
  AiDifficulty,
  Color,
  GameMode,
  GameSnapshot,
  Promotion,
  StoredMove,
  Termination,
  TurnPaceDays,
} from "./game-types";

export interface GameRow {
  id: string;
  create_request_id: string;
  status: "waiting" | "active" | "completed";
  white_name: string;
  black_name: string | null;
  white_token_hash: string;
  black_token_hash: string | null;
  invite_token_hash: string;
  initial_fen: string;
  current_fen: string;
  turn_color: Color;
  version: number;
  ply_count: number;
  winner_color: Color | null;
  termination: Termination | null;
  last_mutation_nonce: string | null;
  created_at: string;
  joined_at: string | null;
  updated_at: string;
  finished_at: string | null;
  game_mode: GameMode;
  variant_id: GameVariantId;
  ai_difficulty: AiDifficulty | null;
  human_color: Color;
  turn_pace_days: TurnPaceDays | null;
  magic_prompt: string | null;
  magic_rules_json: string | null;
  world_code: string | null;
  world_creator_username: string | null;
  world_created_at: string | null;
}

interface MoveRow {
  game_id: string;
  ply: number;
  request_id: string;
  color: Color;
  from_square: string;
  to_square: string;
  promotion: Promotion | null;
  san: string;
  second_from_square: string | null;
  second_to_square: string | null;
  second_san: string | null;
  continuation_json?: string | null;
  fen_before: string;
  fen_after: string;
  created_at: string;
}

export async function findGameById(id: string): Promise<GameRow | null> {
  await ensureSchema();
  return (
    (await getDatabase()
      .prepare(`SELECT games.*,
        COALESCE(game_settings.game_mode, 'multiplayer') AS game_mode,
        COALESCE(game_settings.variant_id, 'standard') AS variant_id,
        game_settings.ai_difficulty AS ai_difficulty,
        COALESCE(game_settings.human_color, 'w') AS human_color,
        game_settings.turn_pace_days AS turn_pace_days,
        game_settings.magic_prompt AS magic_prompt,
        game_settings.magic_rules_json AS magic_rules_json,
        game_settings.world_code AS world_code,
        world_creator.username AS world_creator_username,
        magic_worlds.created_at AS world_created_at
        FROM games
        LEFT JOIN game_settings ON game_settings.game_id = games.id
        LEFT JOIN magic_worlds ON magic_worlds.code = game_settings.world_code
        LEFT JOIN accounts AS world_creator ON world_creator.id = magic_worlds.creator_account_id
        WHERE games.id = ?`)
      .bind(id)
      .first<GameRow>()) ?? null
  );
}

export async function findGameByCreateRequest(requestId: string): Promise<GameRow | null> {
  await ensureSchema();
  return (
    (await getDatabase()
      .prepare(`SELECT games.*,
        COALESCE(game_settings.game_mode, 'multiplayer') AS game_mode,
        COALESCE(game_settings.variant_id, 'standard') AS variant_id,
        game_settings.ai_difficulty AS ai_difficulty,
        COALESCE(game_settings.human_color, 'w') AS human_color,
        game_settings.turn_pace_days AS turn_pace_days,
        game_settings.magic_prompt AS magic_prompt,
        game_settings.magic_rules_json AS magic_rules_json,
        game_settings.world_code AS world_code,
        world_creator.username AS world_creator_username,
        magic_worlds.created_at AS world_created_at
        FROM games
        LEFT JOIN game_settings ON game_settings.game_id = games.id
        LEFT JOIN magic_worlds ON magic_worlds.code = game_settings.world_code
        LEFT JOIN accounts AS world_creator ON world_creator.id = magic_worlds.creator_account_id
        WHERE games.create_request_id = ?`)
      .bind(requestId)
      .first<GameRow>()) ?? null
  );
}

export async function findGameByInviteHash(inviteHash: string): Promise<GameRow | null> {
  await ensureSchema();
  return (
    (await getDatabase()
      .prepare(`SELECT games.*,
        COALESCE(game_settings.game_mode, 'multiplayer') AS game_mode,
        COALESCE(game_settings.variant_id, 'standard') AS variant_id,
        game_settings.ai_difficulty AS ai_difficulty,
        COALESCE(game_settings.human_color, 'w') AS human_color,
        game_settings.turn_pace_days AS turn_pace_days,
        game_settings.magic_prompt AS magic_prompt,
        game_settings.magic_rules_json AS magic_rules_json,
        game_settings.world_code AS world_code,
        world_creator.username AS world_creator_username,
        magic_worlds.created_at AS world_created_at
        FROM games
        LEFT JOIN game_settings ON game_settings.game_id = games.id
        LEFT JOIN magic_worlds ON magic_worlds.code = game_settings.world_code
        LEFT JOIN accounts AS world_creator ON world_creator.id = magic_worlds.creator_account_id
        WHERE games.invite_token_hash = ?`)
      .bind(inviteHash)
      .first<GameRow>()) ?? null
  );
}

export async function readMoves(gameId: string): Promise<StoredMove[]> {
  await ensureSchema();
  const result = await getDatabase()
    .prepare("SELECT * FROM moves WHERE game_id = ? ORDER BY ply ASC")
    .bind(gameId)
    .all<MoveRow>();
  return (result.results ?? []).map((row: MoveRow) => {
    const legacySecond = row.second_from_square && row.second_to_square && row.second_san
      ? {
        from: row.second_from_square,
        to: row.second_to_square,
        san: row.second_san,
      }
      : null;
    const continuation = row.continuation_json === null || row.continuation_json === undefined
      ? legacySecond ? [legacySecond] : []
      : parseMoveContinuation(row.continuation_json);
    return {
      ply: row.ply,
      requestId: row.request_id,
      color: row.color,
      from: row.from_square,
      to: row.to_square,
      promotion: row.promotion,
      san: row.san,
      second: continuation[0]
        ? {
          from: continuation[0].from,
          to: continuation[0].to,
          san: continuation[0].san,
        }
        : null,
      continuation,
      fenBefore: row.fen_before,
      fenAfter: row.fen_after,
      createdAt: row.created_at,
    };
  });
}

export function playerColor(game: GameRow, tokenHash: string): Color | null {
  if (game.white_token_hash === tokenHash) return "w";
  if (game.black_token_hash === tokenHash) return "b";
  return null;
}

export async function accountPlayerColor(
  game: GameRow,
  accountId: string,
): Promise<Color | null> {
  await ensureSchema();
  const existing = await getDatabase()
    .prepare(`SELECT color FROM game_memberships
      WHERE game_id = ? AND account_id = ?`)
    .bind(game.id, accountId)
    .first<{ color: Color }>();
  if (existing?.color === "w" || existing?.color === "b") return existing.color;
  return null;
}

export type GoogleSeatLinkResult =
  | {
      ok: true;
      color: Color;
      alreadyLinked: boolean;
    }
  | {
      ok: false;
      reason:
        | "invalid_account"
        | "invalid_token"
        | "account_owns_opposite_seat"
        | "seat_already_linked"
        | "link_conflict";
    };

const GOOGLE_ACCOUNT_ID_PATTERN = /^google_[A-Za-z0-9_-]{43}$/;

async function gameMemberships(gameId: string): Promise<Map<Color, string>> {
  const result = await getDatabase()
    .prepare(`SELECT color, account_id FROM game_memberships
      WHERE game_id = ?`)
    .bind(gameId)
    .all<{ color: Color; account_id: string }>();
  const memberships = new Map<Color, string>();
  for (const row of result.results ?? []) {
    if (row.color === "w" || row.color === "b") {
      memberships.set(row.color, row.account_id);
    }
  }
  return memberships;
}

function settledGoogleSeatLink(
  memberships: Map<Color, string>,
  color: Color,
  accountId: string,
): GoogleSeatLinkResult {
  if (memberships.get(color) === accountId) {
    return { ok: true, color, alreadyLinked: true };
  }
  if (memberships.get(oppositeColor(color)) === accountId) {
    return { ok: false, reason: "account_owns_opposite_seat" };
  }
  const owner = memberships.get(color);
  if (owner && GOOGLE_ACCOUNT_ID_PATTERN.test(owner)) {
    return { ok: false, reason: "seat_already_linked" };
  }
  return { ok: false, reason: "link_conflict" };
}

/**
 * Explicitly replaces a legacy private-seat membership with a Google account.
 *
 * Callers must independently require a valid Google session and the original
 * private seat token, so merely opening a private link cannot change ownership.
 */
export async function linkGuestSeatToGoogleAccount(
  game: GameRow,
  accountId: string,
  tokenHash: string,
): Promise<GoogleSeatLinkResult> {
  if (!GOOGLE_ACCOUNT_ID_PATTERN.test(accountId)) {
    return { ok: false, reason: "invalid_account" };
  }
  const color = playerColor(game, tokenHash);
  if (!color) return { ok: false, reason: "invalid_token" };

  await ensureSchema();
  const db = getDatabase();
  let memberships = await gameMemberships(game.id);
  if (memberships.get(color) === accountId) {
    return { ok: true, color, alreadyLinked: true };
  }
  if (memberships.get(oppositeColor(color)) === accountId) {
    return { ok: false, reason: "account_owns_opposite_seat" };
  }

  const previousAccountId = memberships.get(color);
  if (previousAccountId && GOOGLE_ACCOUNT_ID_PATTERN.test(previousAccountId)) {
    return { ok: false, reason: "seat_already_linked" };
  }

  const now = new Date().toISOString();
  if (!previousAccountId) {
    try {
      const inserted = await db
        .prepare(`INSERT INTO game_memberships (
          game_id, color, account_id, claimed_at
        ) SELECT ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM game_memberships
          WHERE game_id = ? AND account_id = ?
        )`)
        .bind(game.id, color, accountId, now, game.id, accountId)
        .run();
      if ((inserted.meta.changes ?? 0) === 1) {
        return { ok: true, color, alreadyLinked: false };
      }
    } catch {
      // A concurrent claimant may have won. Resolve from current state below.
    }
    memberships = await gameMemberships(game.id);
    return settledGoogleSeatLink(memberships, color, accountId);
  }

  try {
    const migration = await db.batch([
      db.prepare(`UPDATE game_memberships
        SET account_id = ?, claimed_at = ?
        WHERE game_id = ? AND color = ? AND account_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM game_memberships
            WHERE game_id = ? AND account_id = ?
          )`)
        .bind(
          accountId,
          now,
          game.id,
          color,
          previousAccountId,
          game.id,
          accountId,
        ),
      db.prepare(`UPDATE push_subscriptions
        SET account_id = ?, updated_at = ?
        WHERE game_id = ? AND color = ? AND account_id = ?
          AND EXISTS (
            SELECT 1 FROM game_memberships
            WHERE game_id = ? AND color = ? AND account_id = ?
          )`)
        .bind(
          accountId,
          now,
          game.id,
          color,
          previousAccountId,
          game.id,
          color,
          accountId,
        ),
    ]);
    if ((migration[0]?.meta.changes ?? 0) === 1) {
      return { ok: true, color, alreadyLinked: false };
    }
  } catch {
    // A concurrent claimant may have won. Resolve from current state below.
  }

  memberships = await gameMemberships(game.id);
  return settledGoogleSeatLink(memberships, color, accountId);
}

export async function membershipAccountId(
  gameId: string,
  color: Color,
): Promise<string | null> {
  await ensureSchema();
  const membership = await getDatabase()
    .prepare(`SELECT account_id FROM game_memberships
      WHERE game_id = ? AND color = ?`)
    .bind(gameId, color)
    .first<{ account_id: string }>();
  return membership?.account_id ?? null;
}

export async function addGameMembership(
  gameId: string,
  color: Color,
  accountId: string,
  claimedAt: string,
): Promise<void> {
  await ensureSchema();
  await getDatabase()
    .prepare(`INSERT INTO game_memberships (
      game_id, color, account_id, claimed_at
    ) VALUES (?, ?, ?, ?)`)
    .bind(gameId, color, accountId, claimedAt)
    .run();
}

export function oppositeColor(color: Color): Color {
  return color === "w" ? "b" : "w";
}

export function computerColor(game: GameRow): Color | null {
  return game.game_mode === "solo" ? oppositeColor(game.human_color) : null;
}

export function gameMagicRules(game: GameRow): CompiledMagicRules | null {
  return parseStoredMagicRules(game.magic_rules_json);
}

export function multiplayerTurnDeadline(game: GameRow): string | null {
  return game.game_mode === "multiplayer"
    && game.status === "active"
    && game.turn_pace_days
    ? turnDeadlineAt(game.updated_at, game.turn_pace_days)
    : null;
}

export async function expireMultiplayerTurn(
  game: GameRow,
  nowMs = Date.now(),
): Promise<GameRow> {
  const deadlineAt = multiplayerTurnDeadline(game);
  if (deadlineAt === null || Date.parse(deadlineAt) > nowMs) {
    return game;
  }

  const winner = oppositeColor(game.turn_color);
  const result = await getDatabase()
    .prepare(`UPDATE games SET
      status = 'completed', winner_color = ?, termination = 'timeout',
      version = version + 1, last_mutation_nonce = ?, updated_at = ?, finished_at = ?
      WHERE id = ? AND version = ? AND status = 'active'`)
    .bind(
      winner,
      crypto.randomUUID(),
      deadlineAt,
      deadlineAt,
      game.id,
      game.version,
    )
    .run();
  const current = await findGameById(game.id);
  if ((result.meta.changes ?? 0) === 1) {
    await recordEvent({
      event: "game.completed",
      outcome: "success",
      subjectId: game.id,
      metadata: {
        mode: "multiplayer",
        termination: "timeout",
        winner,
      },
    });
  }
  return current ?? game;
}

/**
 * Lazily adjudicates overdue games before account-level dashboard and activity
 * reads. Every candidate is settled before the page is queried so the same
 * response can never return a known-overdue game as active.
 */
export async function expireAccountMultiplayerTurns(
  accountId: string | string[],
  nowMs?: number,
): Promise<number> {
  await ensureSchema();
  const accountIds = [...new Set(
    (Array.isArray(accountId) ? accountId : [accountId]).filter(Boolean),
  )];
  if (!accountIds.length) return 0;

  const membershipPlaceholders = accountIds.map(() => "?").join(",");
  const settled = await getDatabase()
    .prepare(`UPDATE games AS target SET
        status = 'completed',
        winner_color = CASE target.turn_color WHEN 'w' THEN 'b' ELSE 'w' END,
        termination = 'timeout',
        version = target.version + 1,
        last_mutation_nonce = lower(hex(randomblob(16))),
        updated_at = (
          SELECT strftime(
            '%Y-%m-%dT%H:%M:%fZ',
            target.updated_at,
            '+' || settings.turn_pace_days || ' days'
          )
          FROM game_settings AS settings
          WHERE settings.game_id = target.id
        ),
        finished_at = (
          SELECT strftime(
            '%Y-%m-%dT%H:%M:%fZ',
            target.updated_at,
            '+' || settings.turn_pace_days || ' days'
          )
          FROM game_settings AS settings
          WHERE settings.game_id = target.id
        )
      WHERE target.status = 'active'
        AND target.id IN (
          SELECT game_memberships.game_id
          FROM game_memberships
          WHERE game_memberships.account_id IN (${membershipPlaceholders})
        )
        AND EXISTS (
          SELECT 1
          FROM game_settings AS settings
          WHERE settings.game_id = target.id
            AND settings.game_mode = 'multiplayer'
            AND settings.turn_pace_days IN (1, 3, 5)
            AND julianday(COALESCE(?, 'now')) >= julianday(
              target.updated_at,
              '+' || settings.turn_pace_days || ' days'
            )
        )
      RETURNING id`)
    .bind(
      ...accountIds,
      nowMs === undefined ? null : new Date(nowMs).toISOString(),
    )
    .all<{ id: string }>();
  const expired = settled.results?.length ?? 0;
  if (expired > 0) await recordEvent({
    event: "game.completed",
    outcome: "success",
    metadata: {
      mode: "multiplayer",
      termination: "timeout",
      source: "account_sync",
      count: expired,
    },
  });
  return expired;
}

export function assertAuthoritativeState(
  game: GameRow,
  moves: StoredMove[],
): Chess {
  const replayed = replayWithRepetition(
    game.initial_fen,
    moves,
    gameMagicRules(game),
  ).chess;
  if (
    replayed.fen() !== game.current_fen
    || replayed.turn() !== game.turn_color
    || moves.length !== game.ply_count
  ) {
    throw new Error("Stored game history does not match the authoritative state");
  }
  return replayed;
}

export function snapshot(
  game: GameRow,
  moves: StoredMove[],
  you: Color,
  nowMs = Date.now(),
): GameSnapshot {
  const magicRules = gameMagicRules(game);
  const replayed = replayWithRepetition(game.initial_fen, moves, magicRules);
  const position = replayed.chess;
  const clocks = gameClockSnapshot({
    mode: game.game_mode,
    status: game.status,
    turn: game.turn_color,
    createdAt: game.created_at,
    joinedAt: game.joined_at,
    finishedAt: game.finished_at,
    moves,
  }, nowMs);
  return {
    id: game.id,
    mode: game.game_mode,
    variantId: normalizeGameVariantId(game.variant_id),
    aiDifficulty: game.ai_difficulty,
    turnPaceDays: game.turn_pace_days,
    magicRules: publicMagicRules(game.magic_prompt, magicRules),
    world: game.world_code && game.world_created_at ? {
      code: game.world_code,
      displayCode: displayMagicWorldCode(game.world_code),
      creatorUsername: game.world_creator_username,
      createdAt: game.world_created_at,
    } : null,
    status: game.status,
    version: game.version,
    initialFen: game.initial_fen,
    fen: game.current_fen,
    turn: game.turn_color,
    plyCount: game.ply_count,
    ...clocks,
    players: {
      white: { name: game.white_name },
      black: game.black_name ? { name: game.black_name } : null,
    },
    you: { color: you, name: you === "w" ? game.white_name : game.black_name ?? "Player 2" },
    check: position.isCheck(),
    claimableDraws: game.status === "active" && game.turn_color === you
      ? claimableDraws(position, replayed.currentRepetitionCount)
      : [],
    outcome: game.termination
      ? { winner: game.winner_color, reason: game.termination }
      : null,
    moves: moves.map(({
      ply,
      color,
      from,
      to,
      promotion,
      san,
      second,
      continuation,
      fenBefore,
      fenAfter,
      createdAt,
    }) => ({
      ply,
      color,
      from,
      to,
      promotion,
      san,
      second,
      continuation,
      fenBefore,
      fenAfter,
      createdAt,
    })),
    updatedAt: game.updated_at,
    deadlineAt: multiplayerTurnDeadline(game),
  };
}
