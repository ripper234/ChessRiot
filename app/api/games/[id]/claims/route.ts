import { getDatabase } from "@/db";
import { claimableDraws, replayWithRepetition } from "@/lib/game-rules";
import {
  assertAuthoritativeState,
  findGameById,
  playerColor,
  readMoves,
  snapshot,
} from "@/lib/game-store";
import { apiError, bearerToken, json, readJson } from "@/lib/http";
import type { DrawClaim } from "@/lib/game-types";
import { hashSecret, isUuid, requestIsSameOrigin } from "@/lib/validation";
import { recordEvent } from "@/lib/observability";

export const dynamic = "force-dynamic";

function isDrawClaim(value: unknown): value is DrawClaim {
  return value === "threefold_repetition" || value === "fifty_move";
}

function changes(result: D1Result<unknown> | undefined): number {
  return result?.meta.changes ?? 0;
}

interface ActionRow {
  action_type: string;
  payload: string;
}

async function readAction(gameId: string, requestId: string): Promise<ActionRow | null> {
  return (
    await getDatabase()
      .prepare(`SELECT action_type, payload FROM game_actions
        WHERE game_id = ? AND request_id = ?`)
      .bind(gameId, requestId)
      .first<ActionRow>()
  ) ?? null;
}

function sameClaim(action: ActionRow | null, claim: DrawClaim, color: "w" | "b"): boolean {
  if (!action || action.action_type !== "draw_claim") return false;
  try {
    const payload = JSON.parse(action.payload) as { claim?: unknown; color?: unknown };
    return payload.claim === claim && payload.color === color;
  } catch {
    return false;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const token = bearerToken(request);
  const body = await readJson(request);
  const claim = body?.claim;
  const expectedVersion = body?.expectedVersion;
  const requestId = body?.requestId;
  if (
    !token
    || !isDrawClaim(claim)
    || !Number.isInteger(expectedVersion)
    || (expectedVersion as number) < 0
    || !isUuid(requestId)
  ) {
    return apiError(400, "invalid_request", "Draw claim request is invalid");
  }

  const { id } = await context.params;
  let game = await findGameById(id);
  if (!game) return apiError(404, "not_found", "Game not found");
  const color = playerColor(game, await hashSecret(token));
  if (!color) return apiError(404, "not_found", "Game not found");
  let moves = await readMoves(id);
  const existingAction = await readAction(id, requestId);
  if (existingAction) {
    if (!sameClaim(existingAction, claim, color)) {
      return apiError(409, "idempotency_conflict", "This request id was already used");
    }
    return json({ game: snapshot(game, moves, color) });
  }
  if (game.status !== "active") return apiError(409, "game_not_active", "The game is not active");
  if (game.version !== expectedVersion) {
    return json(
      { error: { code: "stale_position", message: "The board changed" }, game: snapshot(game, moves, color) },
      { status: 409 },
    );
  }
  if (game.turn_color !== color) return apiError(409, "wrong_turn", "It is not your turn");

  try {
    assertAuthoritativeState(game, moves);
  } catch {
    return apiError(500, "history_mismatch", "Stored game history does not match the board");
  }
  const replayed = replayWithRepetition(game.initial_fen, moves);
  if (!claimableDraws(replayed.chess, replayed.currentRepetitionCount).includes(claim)) {
    return apiError(422, "draw_not_claimable", "That draw cannot be claimed now");
  }

  const now = new Date().toISOString();
  const nextVersion = game.version + 1;
  const nonce = crypto.randomUUID();
  const payload = JSON.stringify({ claim, color });
  let results: D1Result<unknown>[];
  try {
    const db = getDatabase();
    results = await db.batch([
      db.prepare(`UPDATE games SET
        status = 'completed', winner_color = NULL, termination = ?,
        version = ?, last_mutation_nonce = ?, updated_at = ?, finished_at = ?
        WHERE id = ? AND version = ? AND status = 'active' AND turn_color = ?`)
        .bind(
          claim,
          nextVersion,
          nonce,
          now,
          now,
          id,
          expectedVersion,
          color,
        ),
      db.prepare(`INSERT INTO game_actions (
        game_id, request_id, action_type, payload, created_at
      ) SELECT ?, ?, 'draw_claim', ?, ?
        FROM games WHERE id = ? AND version = ? AND last_mutation_nonce = ?`)
        .bind(id, requestId, payload, now, id, nextVersion, nonce),
    ]);
  } catch {
    game = await findGameById(id);
    moves = await readMoves(id);
    const raced = await readAction(id, requestId);
    if (game && sameClaim(raced, claim, color)) {
      return json({ game: snapshot(game, moves, color) });
    }
    if (raced) return apiError(409, "idempotency_conflict", "This request id was already used");
    if (game) {
      return json(
        { error: { code: "stale_position", message: "The board changed" }, game: snapshot(game, moves, color) },
        { status: 409 },
      );
    }
    return apiError(404, "not_found", "Game not found");
  }

  if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
    game = await findGameById(id);
    moves = await readMoves(id);
    const raced = await readAction(id, requestId);
    if (game && sameClaim(raced, claim, color)) {
      return json({ game: snapshot(game, moves, color) });
    }
    if (raced) return apiError(409, "idempotency_conflict", "This request id was already used");
    if (game) {
      return json(
        { error: { code: "stale_position", message: "The board changed" }, game: snapshot(game, moves, color) },
        { status: 409 },
      );
    }
    return apiError(404, "not_found", "Game not found");
  }

  game = await findGameById(id);
  moves = await readMoves(id);
  if (!game) return apiError(500, "claim_failed", "Game disappeared after the claim");
  await recordEvent({
    event: "game.completed",
    outcome: "success",
    requestId,
    subjectId: id,
    metadata: { mode: game.game_mode, termination: claim, winner: null },
  });
  return json({ game: snapshot(game, moves, color) });
}
