import { getDatabase } from "@/db";
import { enforceAccountRateLimit } from "@/lib/accounts";
import { authorizeGameRequest } from "@/lib/game-auth";
import {
  findGameById,
  readMoves,
  snapshot,
  type GameRow,
} from "@/lib/game-store";
import { apiError, json, readJson } from "@/lib/http";
import { queueTurnNotifications } from "@/lib/push-notifications";
import { isUuid, requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

type ChallengeAction = "accept" | "decline";

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

function sameChallengeAction(
  action: ActionRow | null,
  requestedAction: ChallengeAction,
): boolean {
  if (!action || action.action_type !== "challenge_response") return false;
  try {
    return (JSON.parse(action.payload) as { action?: unknown }).action === requestedAction;
  } catch {
    return false;
  }
}

function settledAs(game: GameRow, action: ChallengeAction): boolean {
  if (action === "decline") {
    return game.status === "completed"
      && game.termination === "cancelled"
      && game.joined_at === null;
  }
  return game.joined_at !== null;
}

async function responseFor(
  game: GameRow,
  action: ChallengeAction,
): Promise<Response> {
  return json({
    state: action === "accept" ? "accepted" : "declined",
    game: snapshot(game, await readMoves(game.id), "b"),
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const { id } = await context.params;
  if (!isUuid(id)) return apiError(404, "not_found", "Challenge not found");

  const authorization = await authorizeGameRequest(request, id);
  if (!authorization.ok) {
    return apiError(
      authorization.status,
      authorization.code,
      authorization.message,
    );
  }
  const { account } = authorization;
  if (
    authorization.color !== "b"
    || authorization.game.game_mode !== "multiplayer"
    || !account.username
    || authorization.game.black_name !== account.username
  ) {
    return apiError(403, "challenge_response_forbidden", "Only the invited friend can answer");
  }

  const rate = await enforceAccountRateLimit(account.id, "challenge_response", 60, 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many challenge responses. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }

  const body = await readJson(request);
  const action = body?.action;
  const requestId = body?.requestId;
  if ((action !== "accept" && action !== "decline") || !isUuid(requestId)) {
    return apiError(400, "invalid_request", "Choose accept or decline and try again");
  }

  let game: GameRow | null = authorization.game;
  const existingAction = await readAction(id, requestId);
  if (existingAction) {
    if (!sameChallengeAction(existingAction, action)) {
      return apiError(409, "idempotency_conflict", "This request id was already used");
    }
    return responseFor(game, action);
  }
  if (settledAs(game, action)) return responseFor(game, action);
  if (game.status !== "waiting" || game.joined_at !== null) {
    return apiError(409, "challenge_settled", "That challenge was handled already");
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const expectedVersion = game.version;
    const now = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const nextVersion = game.version + 1;
    const payload = JSON.stringify({ action });
    const update = action === "accept"
      ? getDatabase().prepare(`UPDATE games SET
          status = 'active', winner_color = NULL, termination = NULL,
          joined_at = ?, updated_at = ?, finished_at = NULL, version = ?,
          last_mutation_nonce = ?
          WHERE id = ? AND version = ? AND status = 'waiting' AND joined_at IS NULL
            AND EXISTS (
              SELECT 1 FROM game_memberships
              WHERE game_memberships.game_id = games.id
                AND game_memberships.account_id = ?
                AND game_memberships.color = 'b'
            )`)
        .bind(now, now, nextVersion, nonce, id, game.version, account.id)
      : getDatabase().prepare(`UPDATE games SET
          status = 'completed', winner_color = NULL, termination = 'cancelled',
          updated_at = ?, finished_at = ?, version = ?, last_mutation_nonce = ?
          WHERE id = ? AND version = ? AND status = 'waiting' AND joined_at IS NULL
            AND EXISTS (
              SELECT 1 FROM game_memberships
              WHERE game_memberships.game_id = games.id
                AND game_memberships.account_id = ?
                AND game_memberships.color = 'b'
            )`)
        .bind(now, now, nextVersion, nonce, id, game.version, account.id);

    let results: D1Result<unknown>[];
    try {
      const db = getDatabase();
      const writes = [
        update,
        db.prepare(`INSERT INTO game_actions (
          game_id, request_id, action_type, payload, created_at
        ) SELECT ?, ?, 'challenge_response', ?, ?
          FROM games WHERE id = ? AND version = ? AND last_mutation_nonce = ?`)
          .bind(id, requestId, payload, now, id, nextVersion, nonce),
      ];
      if (action === "accept") {
        writes.push(...queueTurnNotifications(db, {
          gameId: id,
          gameVersion: nextVersion,
          targetColor: game.turn_color,
          mutationNonce: nonce,
          createdAt: now,
        }));
      }
      results = await db.batch(writes);
    } catch {
      game = await findGameById(id);
      const racedAction = await readAction(id, requestId);
      if (game && sameChallengeAction(racedAction, action)) return responseFor(game, action);
      if (racedAction) {
        return apiError(409, "idempotency_conflict", "This request id was already used");
      }
      if (game && settledAs(game, action)) return responseFor(game, action);
      if (attempt === 0 && game?.status === "waiting" && game.joined_at === null
        && game.version !== expectedVersion) continue;
      if (game) return apiError(409, "challenge_settled", "That challenge was handled already");
      return apiError(404, "not_found", "Challenge not found");
    }

    if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
      game = await findGameById(id);
      const racedAction = await readAction(id, requestId);
      if (game && sameChallengeAction(racedAction, action)) return responseFor(game, action);
      if (racedAction) {
        return apiError(409, "idempotency_conflict", "This request id was already used");
      }
      if (game && settledAs(game, action)) return responseFor(game, action);
      if (attempt === 0 && game?.status === "waiting" && game.joined_at === null
        && game.version !== expectedVersion) continue;
      if (game) return apiError(409, "challenge_settled", "That challenge was handled already");
      return apiError(404, "not_found", "Challenge not found");
    }

    game = await findGameById(id);
    if (!game) return apiError(500, "challenge_response_failed", "Challenge disappeared");
    return responseFor(game, action);
  }
  return apiError(409, "challenge_changed", "The challenge changed. Try again.");
}
