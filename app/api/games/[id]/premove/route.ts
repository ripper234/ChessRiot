import { Chess, type Square } from "chess.js";
import { getDatabase } from "@/db";
import { enforceAccountRateLimit } from "@/lib/accounts";
import { authorizeGameRequest } from "@/lib/game-auth";
import { expireMultiplayerTurn, findGameById, readMoves, snapshot } from "@/lib/game-store";
import { apiError, json, readJson } from "@/lib/http";
import { premoveColumn, readPremove, validPremove, type PremoveState } from "@/lib/premoves";
import { isUuid, requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!requestIsSameOrigin(request)) return apiError(403, "wrong_origin", "Request origin is not allowed");
  const { id } = await context.params;
  const auth = await authorizeGameRequest(request, id);
  if (!auth.ok) return apiError(auth.status, auth.code, auth.message);
  const body = await readJson(request);
  if (!body || !isUuid(body.requestId) || !Number.isSafeInteger(body.expectedRevision)
    || Number(body.expectedRevision) < 0 || !Number.isSafeInteger(body.expectedVersion)
    || (body.move !== null && !validPremove(body.move))) return apiError(400, "invalid_premove", "Choose a planned move");
  const rate = await enforceAccountRateLimit(auth.account.id, "premove", 120, 60);
  if (!rate.allowed) return apiError(429, "rate_limited", "Try again shortly");
  const game = await expireMultiplayerTurn(auth.game);
  const current = readPremove(game, auth.color);
  const respond = async (status = 200) => {
    const latest = await findGameById(id);
    return latest ? json({ game: snapshot(latest, await readMoves(id), auth.color) }, { status })
      : apiError(404, "not_found", "Game not found");
  };
  if (current.requestId === body.requestId) {
    const same = current.move === null ? body.move === null : body.move !== null
      && current.move.from === body.move.from && current.move.to === body.move.to
      && current.move.promotion === body.move.promotion;
    return same ? respond() : apiError(409, "idempotency_conflict", "This request was already used");
  }
  if (game.game_mode !== "multiplayer" || game.status !== "active"
    || game.version !== body.expectedVersion || current.revision !== body.expectedRevision
    || (body.move !== null && game.turn_color === auth.color)) return respond(409);
  if (body.move !== null && new Chess(game.current_fen).get(body.move.from as Square)?.color !== auth.color) {
    return apiError(422, "invalid_premove_piece", "Choose one of your pieces");
  }
  const next: PremoveState = { revision: current.revision + 1, status: body.move === null ? "cancelled" : "queued",
    requestId: body.requestId, accountId: auth.account.id, version: game.version, move: body.move };
  const column = premoveColumn(auth.color);
  const result = await getDatabase().prepare(`UPDATE games SET ${column} = ?
    WHERE id = ? AND version = ? AND status = 'active' AND ${column} IS ?
      AND EXISTS (SELECT 1 FROM game_memberships WHERE game_id = games.id AND color = ? AND account_id = ?)`)
    .bind(JSON.stringify(next), id, game.version, game[column] ?? null, auth.color, auth.account.id).run();
  return respond(result.meta.changes === 1 ? 200 : 409);
}
