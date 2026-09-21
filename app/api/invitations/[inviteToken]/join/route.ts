import { ensureSchema, getDatabase } from "@/db";
import {
  accountPlayerColor,
  findGameByInviteHash,
  playerColor,
  readMoves,
  snapshot,
} from "@/lib/game-store";
import { apiError, json, readJson } from "@/lib/http";
import { hashSecret, isSecret, requestIsSameOrigin } from "@/lib/validation";
import { enforceAccountRateLimit, requireGoogleApiAccount } from "@/lib/accounts";
import { queueTurnNotifications } from "@/lib/push-notifications";
import { accountsAreBlocked } from "@/lib/social";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ inviteToken: string }> },
) {
  if (!requestIsSameOrigin(request)) return apiError(403, "wrong_origin", "Request origin is not allowed");
  const { inviteToken } = await context.params;
  const body = await readJson(request);
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google to play");
  if (!account.username) return apiError(428, "username_required", "Choose a username before playing");
  const displayName = account.username;
  const playerToken = body?.playerToken;
  if (
    !isSecret(inviteToken)
    || !isSecret(playerToken)
  ) {
    return apiError(400, "invalid_request", "Invitation, name, or player secret is invalid");
  }
  await ensureSchema();
  const [inviteHash, playerHash] = await Promise.all([hashSecret(inviteToken), hashSecret(playerToken)]);
  let game = await findGameByInviteHash(inviteHash);
  if (!game) return apiError(404, "not_found", "Invitation not found");
  if (game.termination === "cancelled") {
    return apiError(410, "invite_cancelled", "This game was cancelled");
  }
  const existingAccountColor = await accountPlayerColor(game, account.id);
  if (game.white_token_hash === playerHash || existingAccountColor === "w") {
    return apiError(409, "same_player", "The creator cannot claim the second seat");
  }
  // The account membership is authoritative after a successful claim. A
  // response-lost retry may arrive with a freshly generated browser token, so
  // returning the settled seat must not depend on the earlier client secret.
  if (existingAccountColor === "b") {
    return json({ game: snapshot(game, await readMoves(game.id), "b") });
  }
  if (
    game.status !== "waiting"
    && game.black_token_hash !== playerHash
  ) {
    return apiError(409, "invite_claimed", "This invitation has already been claimed");
  }
  const rate = await enforceAccountRateLimit(account.id, "invitation_join", 20, 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many join attempts. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const creator = await getDatabase()
    .prepare("SELECT account_id FROM game_memberships WHERE game_id = ? AND color = 'w'")
    .bind(game.id)
    .first<{ account_id: string }>();
  if (creator && await accountsAreBlocked(account.id, creator.account_id)) {
    return apiError(403, "connection_blocked", "You can’t join this player’s game");
  }
  if (
    game.black_token_hash === playerHash ||
    existingAccountColor === "b"
  ) {
    if (existingAccountColor === "b") {
      return json({ game: snapshot(game, await readMoves(game.id), "b") });
    }
  }
  if (game.status !== "waiting" || game.black_token_hash) {
    if (game.black_token_hash !== playerHash) {
      return apiError(409, "invite_claimed", "This invitation has already been claimed");
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const expectedVersion = game.version;
    const now = new Date().toISOString();
    const database = getDatabase();
    const mutationNonce = crypto.randomUUID();
    const nextVersion = game.version + 1;
    try {
      // D1 executes a batch transactionally. The membership insert can only see
      // the seat activated by the update, and the notification inserts require
      // that same version and nonce. No active seat or turn push can be partial.
      await database.batch([
        database.prepare(`UPDATE games
          SET black_name = ?, black_token_hash = ?, status = 'active', version = ?,
              joined_at = ?, updated_at = ?, last_mutation_nonce = ?
          WHERE id = ?
            AND invite_token_hash = ?
            AND version = ?
            AND status = 'waiting'
            AND black_token_hash IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM game_memberships
              WHERE game_memberships.game_id = games.id
                AND (game_memberships.color = 'b' OR game_memberships.account_id = ?)
            )`)
          .bind(
            displayName,
            playerHash,
            nextVersion,
            now,
            now,
            mutationNonce,
            game.id,
            inviteHash,
            expectedVersion,
            account.id,
          ),
        database.prepare(`INSERT INTO game_memberships (
            game_id, color, account_id, claimed_at
          )
          SELECT games.id, 'b', ?, ?
          FROM games
          WHERE games.id = ?
            AND games.invite_token_hash = ?
            AND games.black_token_hash = ?
            AND NOT EXISTS (
              SELECT 1 FROM game_memberships
              WHERE game_memberships.game_id = games.id
                AND (game_memberships.color = 'b' OR game_memberships.account_id = ?)
            )`)
          .bind(account.id, now, game.id, inviteHash, playerHash, account.id),
        ...queueTurnNotifications(database, {
          gameId: game.id,
          gameVersion: nextVersion,
          targetColor: game.turn_color,
          mutationNonce,
          createdAt: now,
        }),
      ]);
    } catch {
      // A concurrent join may have settled the seat. Resolve from current state
      // below instead of converting a harmless race into a server error.
    }

    game = await findGameByInviteHash(inviteHash);
    if (!game) return apiError(404, "not_found", "Invitation not found");
    if (attempt === 0 && game.status === "waiting" && !game.black_token_hash
      && game.version !== expectedVersion) continue;
    if (game.black_token_hash !== playerHash) {
      return apiError(409, "invite_claimed", "This invitation has already been claimed");
    }
    if (await accountPlayerColor(game, account.id) !== "b") {
      return apiError(409, "invite_claimed", "This invitation has already been claimed");
    }
    if (playerColor(game, playerHash) !== "b") {
      return apiError(500, "join_failed", "The game could not be loaded after joining");
    }
    return json({ game: snapshot(game, await readMoves(game.id), "b") });
  }
  return apiError(409, "invite_changed", "The invitation changed. Try accepting again.");
}
