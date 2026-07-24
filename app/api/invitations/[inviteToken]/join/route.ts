import { ensureSchema, getDatabase } from "@/db";
import { findGameByInviteHash, playerColor, readMoves, snapshot } from "@/lib/game-store";
import { apiError, json, readJson } from "@/lib/http";
import { hashSecret, isSecret, normalizeDisplayName, requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ inviteToken: string }> },
) {
  if (!requestIsSameOrigin(request)) return apiError(403, "wrong_origin", "Request origin is not allowed");
  const { inviteToken } = await context.params;
  const body = await readJson(request);
  const displayName = normalizeDisplayName(body?.displayName);
  const playerToken = body?.playerToken;
  if (!isSecret(inviteToken) || !displayName || !isSecret(playerToken)) {
    return apiError(400, "invalid_request", "Invitation, name, or player secret is invalid");
  }

  await ensureSchema();
  const [inviteHash, playerHash] = await Promise.all([hashSecret(inviteToken), hashSecret(playerToken)]);
  let game = await findGameByInviteHash(inviteHash);
  if (!game) return apiError(404, "not_found", "Invitation not found");
  if (game.termination === "cancelled") {
    return apiError(410, "invite_cancelled", "This game was cancelled");
  }
  if (game.white_token_hash === playerHash) {
    return apiError(409, "same_player", "The creator cannot claim the second seat");
  }
  if (game.black_token_hash === playerHash) {
    return json({ game: snapshot(game, await readMoves(game.id), "b") });
  }
  if (game.status !== "waiting" || game.black_token_hash) {
    return apiError(409, "invite_claimed", "This invitation has already been claimed");
  }

  const now = new Date().toISOString();
  const result = await getDatabase()
    .prepare(`UPDATE games
      SET black_name = ?, black_token_hash = ?, status = 'active', version = version + 1,
          joined_at = ?, updated_at = ?
      WHERE id = ? AND invite_token_hash = ? AND status = 'waiting' AND black_token_hash IS NULL`)
    .bind(displayName, playerHash, now, now, game.id, inviteHash)
    .run();

  game = await findGameByInviteHash(inviteHash);
  if (!game) return apiError(404, "not_found", "Invitation not found");
  if ((result.meta.changes ?? 0) !== 1 && game.black_token_hash !== playerHash) {
    return apiError(409, "invite_claimed", "This invitation has already been claimed");
  }
  if (playerColor(game, playerHash) !== "b") {
    return apiError(500, "join_failed", "The game could not be loaded after joining");
  }
  return json({ game: snapshot(game, await readMoves(game.id), "b") });
}
