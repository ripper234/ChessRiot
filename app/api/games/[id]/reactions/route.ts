import { getDatabase } from "@/db";
import {
  isPostGameReactionKey,
  isReactionKey,
  postGameReactionWindowOpen,
  REACTION_DAILY_LIMIT,
  REACTION_RETENTION_DAYS,
  REACTION_STORAGE_LIMIT,
  type PublicReaction,
  type ReactionKey,
} from "@/lib/game-reactions";
import { expireMultiplayerTurn, findGameById, playerColor } from "@/lib/game-store";
import { apiError, bearerToken, json, readJson } from "@/lib/http";
import type { Color } from "@/lib/game-types";
import { hashSecret, isUuid, requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

const REACTION_COOLDOWN_MS = 5_000;
const REACTION_HISTORY_LIMIT = 20;
const REACTION_RETENTION_MS =
  REACTION_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

interface ReactionRow {
  sequence: number;
  id: string;
  request_id: string;
  sender_color: Color;
  reaction_key: ReactionKey;
  created_at: string;
}

function publicReaction(row: ReactionRow): PublicReaction {
  return {
    id: row.id,
    sequence: row.sequence,
    senderColor: row.sender_color,
    key: row.reaction_key,
    createdAt: row.created_at,
  };
}

async function readReaction(gameId: string, requestId: string): Promise<ReactionRow | null> {
  return (
    await getDatabase()
      .prepare(`SELECT sequence, id, request_id, sender_color, reaction_key, created_at
        FROM game_reactions WHERE game_id = ? AND request_id = ?`)
      .bind(gameId, requestId)
      .first<ReactionRow>()
  ) ?? null;
}

async function authenticate(request: Request, id: string) {
  const token = bearerToken(request);
  if (!token) return null;
  let game = await findGameById(id);
  if (!game) return null;
  const color = playerColor(game, await hashSecret(token));
  if (!color) return null;
  game = await expireMultiplayerTurn(game);
  return { game, color };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const auth = await authenticate(request, id);
  if (!auth) return apiError(404, "not_found", "Game not found");
  if (auth.game.game_mode !== "multiplayer") {
    return apiError(409, "reactions_not_available", "Reactions are for two-player games");
  }
  if (auth.game.status === "waiting" || !auth.game.black_token_hash) {
    return apiError(409, "reactions_not_ready", "Player 2 must join before reactions are available");
  }

  const result = await getDatabase()
    .prepare(`SELECT sequence, id, request_id, sender_color, reaction_key, created_at
      FROM game_reactions WHERE game_id = ?
      ORDER BY sequence DESC LIMIT ?`)
    .bind(id, REACTION_HISTORY_LIMIT)
    .all<ReactionRow>();
  const reactions = (result.results ?? [])
    .map(publicReaction)
    .reverse();
  return json({ reactions });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const body = await readJson(request);
  const key = body?.reaction;
  const requestId = body?.requestId;
  if (!isReactionKey(key) || !isUuid(requestId)) {
    return apiError(400, "invalid_reaction", "Choose one of the preset reactions");
  }

  const { id } = await context.params;
  const auth = await authenticate(request, id);
  if (!auth) return apiError(404, "not_found", "Game not found");
  if (auth.game.game_mode !== "multiplayer") {
    return apiError(409, "reactions_not_available", "Reactions are for two-player games");
  }
  if (auth.game.status === "waiting" || !auth.game.black_token_hash) {
    return apiError(409, "reactions_not_ready", "Player 2 must join before reactions are available");
  }
  const repeated = await readReaction(id, requestId);
  if (repeated) {
    if (repeated.sender_color !== auth.color || repeated.reaction_key !== key) {
      return apiError(409, "idempotency_conflict", "This request id was already used");
    }
    return json({ reaction: publicReaction(repeated) });
  }
  if (
    auth.game.status === "completed"
    && (
      !postGameReactionWindowOpen(auth.game.finished_at ?? auth.game.updated_at)
      || !isPostGameReactionKey(key)
    )
  ) {
    return apiError(
      409,
      "reactions_closed",
      "The post-game reaction window has closed",
    );
  }

  const nowMs = Date.now();
  const reactionId = crypto.randomUUID();
  const createdAt = new Date(nowMs).toISOString();
  const cooldownAfter = new Date(nowMs - REACTION_COOLDOWN_MS).toISOString();
  const dailyAfter = new Date(nowMs - 24 * 60 * 60 * 1_000).toISOString();
  const database = getDatabase();
  try {
    const inserted = await database
      .prepare(`INSERT INTO game_reactions (
        id, game_id, request_id, sender_color, reaction_key, created_at
      )
      SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM game_reactions
        WHERE game_id = ? AND sender_color = ? AND created_at > ?
      )
      AND (
        SELECT COUNT(*) FROM game_reactions
        WHERE game_id = ? AND sender_color = ? AND created_at > ?
      ) < ?`)
      .bind(
        reactionId,
        id,
        requestId,
        auth.color,
        key,
        createdAt,
        id,
        auth.color,
        cooldownAfter,
        id,
        auth.color,
        dailyAfter,
        REACTION_DAILY_LIMIT,
      )
      .run();
    if ((inserted.meta.changes ?? 0) === 0) {
      const raced = await readReaction(id, requestId);
      if (raced && raced.sender_color === auth.color && raced.reaction_key === key) {
        return json({ reaction: publicReaction(raced) });
      }
      if (raced) return apiError(409, "idempotency_conflict", "This request id was already used");
      return apiError(429, "reaction_rate_limited", "Wait a moment before sending another reaction");
    }
  } catch {
    const raced = await readReaction(id, requestId);
    if (
      raced
      && raced.sender_color === auth.color
      && raced.reaction_key === key
    ) {
      return json({ reaction: publicReaction(raced) });
    }
    if (raced) return apiError(409, "idempotency_conflict", "This request id was already used");
    return apiError(500, "reaction_failed", "The reaction could not be saved");
  }

  const stored = await readReaction(id, requestId);
  if (!stored) return apiError(500, "reaction_failed", "The reaction could not be loaded");

  // Retention never changes whether the accepted action succeeded.
  try {
    await database.batch([
      database
        .prepare("DELETE FROM game_reactions WHERE created_at < ?")
        .bind(new Date(nowMs - REACTION_RETENTION_MS).toISOString()),
      database
        .prepare(`DELETE FROM game_reactions WHERE sequence IN (
          SELECT sequence FROM game_reactions WHERE game_id = ?
          ORDER BY sequence DESC LIMIT -1 OFFSET ?
        )`)
        .bind(id, REACTION_STORAGE_LIMIT),
    ]);
  } catch {
    // A later send will retry bounded cleanup.
  }
  return json({ reaction: publicReaction(stored) }, { status: 201 });
}
