import { requireGoogleApiAccount, type AccountProfile } from "./accounts";
import {
  accountPlayerColor,
  findGameById,
  linkGuestSeatToGoogleAccount,
  playerColor,
  type GameRow,
} from "./game-store";
import type { Color } from "./game-types";
import { bearerToken } from "./http";
import { hashSecret } from "./validation";

export type GameAuthorization =
  | {
      ok: true;
      account: AccountProfile;
      game: GameRow;
      color: Color;
    }
  | {
      ok: false;
      status: 401 | 404 | 428;
      code: "sign_in_required" | "username_required" | "not_found";
      message: string;
    };

/**
 * Requires a Google session, then authorizes the account membership. An exact
 * legacy private-seat key may migrate that seat only after Google sign-in.
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

  const account = await requireGoogleApiAccount(request);
  if (!account) {
    return {
      ok: false,
      status: 401,
      code: "sign_in_required",
      message: "Sign in with Google to open this game",
    };
  }
  if (!account.username) {
    return {
      ok: false,
      status: 428,
      code: "username_required",
      message: "Choose your permanent username before playing",
    };
  }
  const accountColor = await accountPlayerColor(game, account.id);
  if (accountColor) return { ok: true, account, game, color: accountColor };

  const token = bearerToken(request);
  const tokenHash = token ? await hashSecret(token) : null;
  const tokenColor = tokenHash ? playerColor(game, tokenHash) : null;
  if (token && tokenColor) {
    const linked = await linkGuestSeatToGoogleAccount(game, account.id, tokenHash!);
    if (linked.ok) return { ok: true, account, game, color: linked.color };
  }

  return {
    ok: false,
    status: 404,
    code: "not_found",
    message: "Game not found",
  };
}
