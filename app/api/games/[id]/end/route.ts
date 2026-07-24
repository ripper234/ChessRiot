import { getDatabase } from "@/db";
import {
  assertAuthoritativeState,
  findGameById,
  oppositeColor,
  playerColor,
  readMoves,
  snapshot,
} from "@/lib/game-store";
import { apiError, bearerToken, json, readJson } from "@/lib/http";
import type { Color, Termination } from "@/lib/game-types";
import { hashSecret, isUuid, requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

interface ActionRow {
  action_type: string;
  payload: string;
}

function changes(result: D1Result<unknown> | undefined): number {
  return result?.meta.changes ?? 0;
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

function sameEnd(action: ActionRow | null, color: Color): boolean {
  if (!action || action.action_type !== "end_game") return false;
  try {
    return (JSON.parse(action.payload) as { color?: unknown }).color === color;
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
  const expectedVersion = body?.expectedVersion;
  const requestId = body?.requestId;
  if (
    !token
    || !Number.isInteger(expectedVersion)
    || (expectedVersion as number) < 0
    || !isUuid(requestId)
  ) {
    return apiError(400, "invalid_request", "End-game request is invalid");
  }

  const { id } = await context.params;
  let game = await findGameById(id);
  if (!game) return apiError(404, "not_found", "Game not found");
  const color = playerColor(game, await hashSecret(token));
  if (!color) return apiError(404, "not_found", "Game not found");
  let moves = await readMoves(id);
  const existingAction = await readAction(id, requestId);
  if (existingAction) {
    if (!sameEnd(existingAction, color)) {
      return apiError(409, "idempotency_conflict", "This request id was already used");
    }
    return json({ game: snapshot(game, moves, color) });
  }
  if (game.status === "completed") {
    return apiError(409, "game_not_active", "The game has already ended");
  }
  if (game.version !== expectedVersion) {
    return json(
      { error: { code: "stale_position", message: "The board changed" }, game: snapshot(game, moves, color) },
      { status: 409 },
    );
  }
  if (game.status === "active") {
    try {
      assertAuthoritativeState(game, moves);
    } catch {
      return apiError(500, "history_mismatch", "Stored game history does not match the board");
    }
  }

  const termination: Termination = game.status === "waiting" ? "cancelled" : "resignation";
  const winner = game.status === "active" ? oppositeColor(color) : null;
  const now = new Date().toISOString();
  const nextVersion = game.version + 1;
  const nonce = crypto.randomUUID();
  const payload = JSON.stringify({ color });
  let results: D1Result<unknown>[];
  try {
    const db = getDatabase();
    results = await db.batch([
      db.prepare(`UPDATE games SET
        status = 'completed', winner_color = ?, termination = ?,
        version = ?, last_mutation_nonce = ?, updated_at = ?, finished_at = ?
        WHERE id = ? AND version = ? AND status IN ('waiting', 'active')`)
        .bind(
          winner,
          termination,
          nextVersion,
          nonce,
          now,
          now,
          id,
          expectedVersion,
        ),
      db.prepare(`INSERT INTO game_actions (
        game_id, request_id, action_type, payload, created_at
      ) SELECT ?, ?, 'end_game', ?, ?
        FROM games WHERE id = ? AND version = ? AND last_mutation_nonce = ?`)
        .bind(id, requestId, payload, now, id, nextVersion, nonce),
    ]);
  } catch {
    game = await findGameById(id);
    moves = await readMoves(id);
    const raced = await readAction(id, requestId);
    if (game && sameEnd(raced, color)) {
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
    if (game && sameEnd(raced, color)) {
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
  if (!game) return apiError(500, "end_failed", "Game disappeared after ending");
  return json({ game: snapshot(game, moves, color) });
}
