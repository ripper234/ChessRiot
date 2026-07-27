import type { Square } from "chess.js";
import { getDatabase } from "@/db";
import { applyCandidate, IllegalMoveError, isPromotion, isSquare } from "@/lib/game-rules";
import {
  assertAuthoritativeState,
  expireMultiplayerTurn,
  findGameById,
  gameMagicRules,
  readMoves,
  snapshot,
  type GameRow,
} from "@/lib/game-store";
import { authorizeGameRequest } from "@/lib/game-auth";
import { enforceAccountRateLimit } from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import type { Promotion } from "@/lib/game-types";
import { isUuid, requestIsSameOrigin } from "@/lib/validation";
import { recordEvent } from "@/lib/observability";
import { hasMagicRule } from "@/lib/magic-rules";

export const dynamic = "force-dynamic";

function changes(result: D1Result<unknown> | undefined): number {
  return result?.meta.changes ?? 0;
}

function isSecondMove(value: unknown): value is { from: string; to: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { from?: unknown; to?: unknown };
  return isSquare(candidate.from) && isSquare(candidate.to);
}

function sameMoveRequest(
  move: Awaited<ReturnType<typeof readMoves>>[number] | undefined,
  color: "w" | "b",
  from: string,
  to: string,
  promotion: Promotion | undefined,
  second: { from: string; to: string } | undefined,
): boolean {
  return Boolean(
    move
    && move.color === color
    && move.from === from
    && move.to === to
    && (move.promotion ?? undefined) === promotion
    && (move.second?.from ?? undefined) === second?.from
    && (move.second?.to ?? undefined) === second?.to
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!requestIsSameOrigin(request)) return apiError(403, "wrong_origin", "Request origin is not allowed");
  const { id } = await context.params;
  const authorization = await authorizeGameRequest(request, id);
  if (!authorization.ok) {
    return apiError(
      authorization.status,
      authorization.code,
      authorization.message,
    );
  }
  const rate = await enforceAccountRateLimit(
    authorization.account.id,
    "game_move",
    120,
    60,
  );
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many move attempts. Try again shortly." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const body = await readJson(request);
  const from = body?.from;
  const to = body?.to;
  const promotion = body?.promotion;
  const second = body?.second;
  const expectedVersion = body?.expectedVersion;
  const requestId = body?.requestId;
  if (
    !isSquare(from) ||
    !isSquare(to) ||
    (promotion !== undefined && !isPromotion(promotion)) ||
    (second !== undefined && !isSecondMove(second)) ||
    !Number.isInteger(expectedVersion) ||
    (expectedVersion as number) < 0 ||
    !isUuid(requestId)
  ) {
    return apiError(400, "invalid_request", "Move request is invalid");
  }
  const secondMove = second as { from: string; to: string } | undefined;

  const { color } = authorization;
  let game: GameRow | null = authorization.game;
  game = await expireMultiplayerTurn(game);

  let storedMoves = await readMoves(id);
  const repeated = storedMoves.find((move) => move.requestId === requestId);
  if (repeated) {
    if (!sameMoveRequest(
      repeated,
      color,
      from,
      to,
      promotion as Promotion | undefined,
      secondMove,
    )) {
      return apiError(409, "idempotency_conflict", "This move request id was already used");
    }
    return json({ game: snapshot(game, storedMoves, color) });
  }
  if (game.status !== "active") return apiError(409, "game_not_active", "The game is not active");
  if (game.version !== expectedVersion) {
    return json(
      { error: { code: "stale_position", message: "The board changed" }, game: snapshot(game, storedMoves, color) },
      { status: 409 },
    );
  }
  if (game.turn_color !== color) return apiError(409, "wrong_turn", "It is not your turn");

  let replayed;
  try {
    replayed = assertAuthoritativeState(game, storedMoves);
  } catch {
    return apiError(500, "history_mismatch", "Stored game history does not match the board");
  }
  const magicRules = gameMagicRules(game);
  const piece = replayed.get(from as Square);
  if (promotion !== undefined && hasMagicRule(magicRules, "no_promotion")) {
    return apiError(422, "promotion_disabled", "Pawns cannot promote in this game");
  }
  if (
    piece?.type === "p"
    && (to.endsWith("8") || to.endsWith("1"))
    && promotion === undefined
    && !hasMagicRule(magicRules, "no_promotion")
  ) {
    return apiError(422, "promotion_required", "Choose a promotion piece");
  }

  let outcome;
  const wasInCheck = replayed.isCheck();
  try {
    outcome = applyCandidate(game.initial_fen, storedMoves, {
      from,
      to,
      ...(promotion ? { promotion: promotion as Promotion } : {}),
      ...(secondMove ? {
        second: {
          from: secondMove.from,
          to: secondMove.to,
        },
      } : {}),
    }, magicRules);
  } catch (error) {
    if (error instanceof IllegalMoveError) {
      return wasInCheck
        ? apiError(
          422,
          "must_answer_check",
          "You are in check. Move the king, capture the attacker, or block the attack.",
        )
        : apiError(422, "illegal_move", "That move is not legal");
    }
    throw error;
  }

  const now = new Date().toISOString();
  const attemptNonce = crypto.randomUUID();
  const humanPly = game.ply_count + 1;
  const nextVersion = game.version + 1;
  const nextPly = game.ply_count + 1;
  const status = outcome.completed ? "completed" : "active";
  const db = getDatabase();
  const update = db
    .prepare(`UPDATE games SET
      status = ?, current_fen = ?, turn_color = ?, version = ?, ply_count = ?,
      winner_color = ?, termination = ?, last_mutation_nonce = ?, updated_at = ?, finished_at = ?
      WHERE id = ? AND version = ? AND status = 'active' AND turn_color = ?
        AND EXISTS (
          SELECT 1 FROM game_memberships
          WHERE game_memberships.game_id = games.id
            AND game_memberships.account_id = ?
            AND game_memberships.color = ?
        )`)
    .bind(
      status,
      outcome.fenAfter,
      outcome.turn,
      nextVersion,
      nextPly,
      outcome.winner,
      outcome.termination,
      attemptNonce,
      now,
      outcome.completed ? now : null,
      id,
      expectedVersion,
      color,
      authorization.account.id,
      color,
    );
  const insert = db
    .prepare(`INSERT INTO moves (
      game_id, ply, request_id, color, from_square, to_square, promotion,
      san, second_from_square, second_to_square, second_san,
      fen_before, fen_after, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      FROM games WHERE id = ? AND version = ? AND last_mutation_nonce = ?`)
    .bind(
      id,
      humanPly,
      requestId,
      color,
      from,
      to,
      promotion ?? null,
      outcome.move.san,
      secondMove?.from ?? null,
      secondMove?.to ?? null,
      outcome.secondMove?.san ?? null,
      outcome.fenBefore,
      outcome.fenAfter,
      now,
      id,
      nextVersion,
      attemptNonce,
    );

  let results: D1Result<unknown>[];
  try {
    results = await db.batch([update, insert]);
  } catch {
    game = await findGameById(id);
    storedMoves = await readMoves(id);
    const wonRace = storedMoves.find((move) => move.requestId === requestId);
    if (game && wonRace) {
      if (sameMoveRequest(
        wonRace,
        color,
        from,
        to,
        promotion as Promotion | undefined,
        secondMove,
      )) {
        return json({ game: snapshot(game, storedMoves, color) });
      }
      return apiError(409, "idempotency_conflict", "This move request id was already used");
    }
    if (game) {
      return json(
        { error: { code: "stale_position", message: "The board changed" }, game: snapshot(game, storedMoves, color) },
        { status: 409 },
      );
    }
    return apiError(404, "not_found", "Game not found");
  }

  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    game = await findGameById(id);
    storedMoves = await readMoves(id);
    const wonRace = storedMoves.find((move) => move.requestId === requestId);
    if (game && wonRace) {
      if (sameMoveRequest(
        wonRace,
        color,
        from,
        to,
        promotion as Promotion | undefined,
        secondMove,
      )) {
        return json({ game: snapshot(game, storedMoves, color) });
      }
      return apiError(409, "idempotency_conflict", "This move request id was already used");
    }
    if (game) {
      return json(
        { error: { code: "stale_position", message: "The board changed" }, game: snapshot(game, storedMoves, color) },
        { status: 409 },
      );
    }
    return apiError(404, "not_found", "Game not found");
  }

  game = await findGameById(id);
  storedMoves = await readMoves(id);
  if (!game) return apiError(500, "move_failed", "Game disappeared after the move");
  if (game.status === "completed") {
    await recordEvent({
      event: "game.completed",
      outcome: "success",
      requestId,
      subjectId: id,
      metadata: {
        mode: game.game_mode,
        termination: game.termination,
        winner: game.winner_color,
      },
    });
  }
  return json(
    { game: snapshot(game, storedMoves, color) },
    game.game_mode === "multiplayer" && game.status === "active"
      ? { headers: { "x-chessriot-turn-committed": "1" } }
      : undefined,
  );
}
