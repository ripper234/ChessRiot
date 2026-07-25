import { findGameByInviteHash, gameMagicRules } from "@/lib/game-store";
import { apiError, json } from "@/lib/http";
import { enforceAccountRateLimit, requireApiAccount } from "@/lib/accounts";
import { hashSecret, isSecret } from "@/lib/validation";
import { publicMagicRules } from "@/lib/magic-rules";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ inviteToken: string }> },
) {
  const account = await requireApiAccount(request);
  if (!account) {
    return apiError(401, "account_required", "Sign in to continue");
  }
  const rate = await enforceAccountRateLimit(
    account.id,
    "invitation_preview",
    120,
    60 * 60,
  );
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many invitation checks. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const { inviteToken } = await context.params;
  if (!isSecret(inviteToken)) return apiError(404, "not_found", "Invitation not found");
  const game = await findGameByInviteHash(await hashSecret(inviteToken));
  if (!game) return apiError(404, "not_found", "Invitation not found");
  if (game.termination === "cancelled") {
    return json(
      { state: "cancelled", gameId: game.id },
      { status: 410, headers: { "referrer-policy": "no-referrer" } },
    );
  }
  if (game.status !== "waiting") {
    return json(
      { state: "claimed", gameId: game.id },
      { status: 410, headers: { "referrer-policy": "no-referrer" } },
    );
  }
  return json(
    {
      state: "waiting",
      gameId: game.id,
      creatorName: game.white_name,
      magicRules: publicMagicRules(game.magic_prompt, gameMagicRules(game)),
    },
    { headers: { "referrer-policy": "no-referrer" } },
  );
}
