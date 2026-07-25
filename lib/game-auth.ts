import { verifiedRequestAccount, type PlayerAccount } from "./account-auth";
import {
  accountPlayerColor,
  findGameById,
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
      code: "account_required" | "not_found";
      message: string;
    };

/**
 * Authorizes a verified account for one of a game's player seats.
 *
 * Existing account memberships are sufficient on their own. A legacy seat
 * token may be supplied once to claim an unbound seat for the signed-in
 * account, preserving access to games created before accounts were required.
 */
export async function authorizeGameRequest(
  request: Request,
  gameId: string,
): Promise<GameAuthorization> {
  const account = await verifiedRequestAccount(request);
  if (!account) {
    return {
      ok: false,
      status: 401,
      code: "account_required",
      message: "Sign in and complete the human check",
    };
  }

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
  const color = await accountPlayerColor(
    game,
    account.id,
    token ? await hashSecret(token) : null,
  );
  if (!color) {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      message: "Game not found",
    };
  }

  return { ok: true, account, game, color };
}
