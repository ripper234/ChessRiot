import { findGameByInviteHash } from "@/lib/game-store";
import { apiError, json } from "@/lib/http";
import { hashSecret, isSecret } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ inviteToken: string }> },
) {
  const { inviteToken } = await context.params;
  if (!isSecret(inviteToken)) return apiError(404, "not_found", "Invitation not found");
  const game = await findGameByInviteHash(await hashSecret(inviteToken));
  if (!game) return apiError(404, "not_found", "Invitation not found");
  if (game.status !== "waiting") {
    return json(
      { state: "claimed", gameId: game.id },
      { status: 410, headers: { "referrer-policy": "no-referrer" } },
    );
  }
  return json(
    { state: "waiting", gameId: game.id, creatorName: game.white_name },
    { headers: { "referrer-policy": "no-referrer" } },
  );
}
