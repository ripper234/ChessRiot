import type { Square } from "chess.js";
import { getDatabase } from "@/db";
import { chooseComputerMove } from "@/lib/computer-player";
import { playPendingComputerTurn } from "@/lib/computer-turn";
import { applyCandidate, IllegalMoveError, isPromotion, isSquare, replayGame } from "@/lib/game-rules";
import { findGameById, playerColor, readMoves, snapshot } from "@/lib/game-store";
import { apiError, bearerToken, json, readJson } from "@/lib/http";
import type { Promotion } from "@/lib/game-types";
import { hashSecret, isUuid, requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

function changes(result: D1Result<unknown> | undefined): number {
  return result?.meta.changes ?? 0;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!requestIsSameOrigin(request)) return apiError(403, "wrong_origin", "Request origin is not allowed");
  const token = bearerToken(request);
  const body = await readJson(request);
  const from = body?.from;
  const to = body?.to;
  const promotion = body?.promotion;
  const expectedVersion = body?.expectedVersion;
  const requestId = body?.requestId;
  if (
    !token ||
    !isSquare(from) ||
    !isSquare(to) ||
    (promotion !== undefined && !isPromotion(promotion)) ||
    !Number.isInteger(expectedVersion) ||
    (expectedVersion as number) < 0 ||
    !isUuid(requestId)
  ) {
    return apiError(400, "invalid_request", "Move request is invalid");
  }

  const { id } = await context.params;
  const tokenHash = await hashSecret(token);
  let game = await findGameById(id);
  if (!game) return apiError(404, "not_found", "Game not found");
  const color = playerColor(game, tokenHash);
  if (!color) return apiError(404, "not_found", "Game not found");

  let storedMoves = await readMoves(id);
  const repeated = storedMoves.find((move) => move.requestId === requestId);
  if (repeated) {
    if (
      repeated.color !== color ||
      repeated.from !== from ||
      repeated.to !== to ||
      (repeated.promotion ?? undefined) !== promotion
    ) {
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

  const replayed = replayGame(game.initial_fen, storedMoves);
  if (replayed.fen() !== game.current_fen) {
    return apiError(500, "history_mismatch", "Stored game history does not match the board");
  }
  const piece = replayed.get(from as Square);
  if (piece?.type === "p" && (to.endsWith("8") || to.endsWith("1")) && promotion === undefined) {
    return apiError(422, "promotion_required", "Choose a promotion piece");
  }

  let outcome;
  try {
    outcome = applyCandidate(game.initial_fen, storedMoves, {
      from,
      to,
      ...(promotion ? { promotion: promotion as Promotion } : {}),
    });
  } catch (error) {
    if (error instanceof IllegalMoveError) return apiError(422, "illegal_move", "That move is not legal");
    throw error;
  }

  const now = new Date().toISOString();
  const attemptNonce = crypto.randomUUID();
  const humanPly = game.ply_count + 1;
  const humanMove = {
    ply: humanPly,
    requestId,
    color,
    from,
    to,
    promotion: (promotion ?? null) as Promotion | null,
    san: outcome.move.san,
    fenBefore: outcome.fenBefore,
    fenAfter: outcome.fenAfter,
    createdAt: now,
  };
  let computerMove: {
    from: string;
    to: string;
    promotion: Promotion | null;
    san: string;
    fenBefore: string;
    fenAfter: string;
  } | null = null;
  let finalOutcome = outcome;

  if (
    game.game_mode === "solo" &&
    color === "w" &&
    !outcome.completed &&
    game.ai_difficulty !== null
  ) {
    const candidate = chooseComputerMove(outcome.fenAfter, game.ai_difficulty);
    if (!candidate) return apiError(500, "computer_move_failed", "The computer could not choose a move");
    const computerOutcome = applyCandidate(game.initial_fen, [...storedMoves, humanMove], candidate);
    computerMove = {
      from: candidate.from,
      to: candidate.to,
      promotion: candidate.promotion ?? null,
      san: computerOutcome.move.san,
      fenBefore: computerOutcome.fenBefore,
      fenAfter: computerOutcome.fenAfter,
    };
    finalOutcome = computerOutcome;
  }

  const pliesAdded = computerMove ? 2 : 1;
  const nextVersion = game.version + pliesAdded;
  const nextPly = game.ply_count + pliesAdded;
  const status = finalOutcome.completed ? "completed" : "active";
  const tokenColumn = color === "w" ? "white_token_hash" : "black_token_hash";
  const db = getDatabase();
  const update = db
    .prepare(`UPDATE games SET
      status = ?, current_fen = ?, turn_color = ?, version = ?, ply_count = ?,
      winner_color = ?, termination = ?, last_mutation_nonce = ?, updated_at = ?, finished_at = ?
      WHERE id = ? AND version = ? AND status = 'active' AND turn_color = ? AND ${tokenColumn} = ?`)
    .bind(
      status,
      finalOutcome.fenAfter,
      finalOutcome.turn,
      nextVersion,
      nextPly,
      finalOutcome.winner,
      finalOutcome.termination,
      attemptNonce,
      now,
      finalOutcome.completed ? now : null,
      id,
      expectedVersion,
      color,
      tokenHash,
    );
  const insert = db
    .prepare(`INSERT INTO moves (
      game_id, ply, request_id, color, from_square, to_square, promotion,
      san, fen_before, fen_after, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
      outcome.fenBefore,
      outcome.fenAfter,
      now,
      id,
      nextVersion,
      attemptNonce,
    );
  const computerInsert = computerMove
    ? db.prepare(`INSERT INTO moves (
      game_id, ply, request_id, color, from_square, to_square, promotion,
      san, fen_before, fen_after, created_at
    ) SELECT ?, ?, ?, 'b', ?, ?, ?, ?, ?, ?, ?
      FROM games WHERE id = ? AND version = ? AND last_mutation_nonce = ?`)
      .bind(
        id,
        humanPly + 1,
        crypto.randomUUID(),
        computerMove.from,
        computerMove.to,
        computerMove.promotion,
        computerMove.san,
        computerMove.fenBefore,
        computerMove.fenAfter,
        now,
        id,
        nextVersion,
        attemptNonce,
      )
    : null;

  let results: D1Result<unknown>[];
  try {
    results = await db.batch(computerInsert ? [update, insert, computerInsert] : [update, insert]);
  } catch {
    game = await findGameById(id);
    storedMoves = await readMoves(id);
    const wonRace = storedMoves.find((move) => move.requestId === requestId);
    if (game && wonRace && wonRace.color === color && wonRace.from === from && wonRace.to === to) {
      return json({ game: snapshot(game, storedMoves, color) });
    }
    if (game) {
      return json(
        { error: { code: "stale_position", message: "The board changed" }, game: snapshot(game, storedMoves, color) },
        { status: 409 },
      );
    }
    return apiError(404, "not_found", "Game not found");
  }

  if (
    changes(results[0]) !== 1 ||
    changes(results[1]) !== 1 ||
    (computerInsert && changes(results[2]) !== 1)
  ) {
    game = await findGameById(id);
    storedMoves = await readMoves(id);
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
  if (game.game_mode === "solo" && game.status === "active" && game.turn_color === "b") {
    await playPendingComputerTurn(id);
    game = await findGameById(id);
    storedMoves = await readMoves(id);
    if (!game) return apiError(500, "move_failed", "Game disappeared after the computer move");
  }
  return json({ game: snapshot(game, storedMoves, color) });
}
