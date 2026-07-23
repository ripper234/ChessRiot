import { findGameById, playerColor, readMoves, snapshot } from "@/lib/game-store";
import { apiError, bearerToken, json } from "@/lib/http";
import { hashSecret } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const token = bearerToken(request);
  if (!token) return apiError(404, "not_found", "Game not found");
  const { id } = await context.params;
  const game = await findGameById(id);
  if (!game) return apiError(404, "not_found", "Game not found");
  const color = playerColor(game, await hashSecret(token));
  if (!color) return apiError(404, "not_found", "Game not found");

  const since = new URL(request.url).searchParams.get("sinceVersion");
  if (since !== null && Number(since) === game.version) {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  return json({ game: snapshot(game, await readMoves(id), color) });
}
