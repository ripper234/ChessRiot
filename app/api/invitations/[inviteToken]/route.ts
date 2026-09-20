import { findGameByInviteHash, gameMagicRules } from "@/lib/game-store";
import { apiError, json } from "@/lib/http";
import {
  enforceAccountRateLimit,
  requireGoogleApiAccount,
} from "@/lib/accounts";
import { hashSecret, isSecret } from "@/lib/validation";
import { publicMagicRules } from "@/lib/magic-rules";
import { normalizeGameVariantId } from "@/lib/game-variants";
import { displayMagicWorldCode } from "@/lib/magic-world-code";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ inviteToken: string }> },
) {
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google to view this invitation");
  if (!account.username) return apiError(428, "username_required", "Choose a username before joining");
  const { inviteToken } = await context.params;
  if (!isSecret(inviteToken)) return apiError(404, "not_found", "Invitation not found");
  const inviteHash = await hashSecret(inviteToken);
  const game = await findGameByInviteHash(inviteHash);
  if (!game) return apiError(404, "not_found", "Invitation not found");
  const rate = await enforceAccountRateLimit(
    `invite_${inviteHash}`,
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
      variantId: normalizeGameVariantId(game.variant_id),
      turnPaceDays: game.turn_pace_days,
      magicRules: publicMagicRules(game.magic_prompt, gameMagicRules(game)),
      world: game.world_code ? {
        code: game.world_code,
        displayCode: displayMagicWorldCode(game.world_code),
        creatorUsername: game.world_creator_username,
      } : null,
    },
    { headers: { "referrer-policy": "no-referrer" } },
  );
}
