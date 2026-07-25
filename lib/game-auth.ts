import {
  guestAccountForToken,
  verifiedRequestAccount,
  type PlayerAccount,
} from "./account-auth";
import { upsertAccount } from "./accounts";
import {
  accountPlayerColor,
  findGameById,
  membershipAccountId,
  playerColor,
  type GameRow,
} from "./game-store";
import type { Color } from "./game-types";
import { bearerToken } from "./http";
import { hashSecret } from "./validation";

export type GameAuthorization =
  | {
      ok: true;
      account: PlayerAccount;
      game: GameRow;
      color: Color;
    }
  | {
      ok: false;
      status: 401 | 404;
      code: "private_link_required" | "not_found";
      message: string;
    };

/**
 * Authorizes either a verified account membership or a private seat key.
 *
 * Account memberships preserve cross-device access when a hosting identity is
 * available. The private seat key remains a complete capability so public
 * guest play never depends on an interactive account gate.
 */
export async function authorizeGameRequest(
  request: Request,
  gameId: string,
): Promise<GameAuthorization> {
  const game = await findGameById(gameId);
  if (!game) {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      message: "Game not found",
    };
  }

  const token = bearerToken(request);
  const tokenHash = token ? await hashSecret(token) : null;
  const account = await verifiedRequestAccount(request);
  if (account) {
    const color = await accountPlayerColor(game, account.id, tokenHash);
    if (color) return { ok: true, account, game, color };
  }

  const tokenColor = tokenHash ? playerColor(game, tokenHash) : null;
  if (token && tokenColor) {
    const existingAccountId = await membershipAccountId(game.id, tokenColor);
    const displayName = tokenColor === "w"
      ? game.white_name
      : game.black_name ?? "Player 2";
    const seatAccount = existingAccountId
      ? { id: existingAccountId, displayName }
      : await guestAccountForToken(token, displayName);
    if (!existingAccountId) {
      await upsertAccount(seatAccount);
      const claimed = await accountPlayerColor(
        game,
        seatAccount.id,
        tokenHash,
      );
      if (claimed !== tokenColor) {
        return {
          ok: false,
          status: 404,
          code: "not_found",
          message: "Game not found",
        };
      }
    }
    return { ok: true, account: seatAccount, game, color: tokenColor };
  }

  if (!account) {
    return {
      ok: false,
      status: 401,
      code: "private_link_required",
      message: "Open the private game link for your seat",
    };
  }

  return {
    ok: false,
    status: 404,
    code: "not_found",
    message: "Game not found",
  };
}
