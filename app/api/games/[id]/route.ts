import {
  computerColor,
  expireMultiplayerTurn,
  findGameById,
  readMoves,
  snapshot,
  type GameRow,
} from "@/lib/game-store";
import { authorizeGameRequest } from "@/lib/game-auth";
import { playPendingComputerTurn } from "@/lib/computer-turn";
import { apiError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

const BOT_READ_RETRY_DELAYS_MS = [25, 40, 60, 90, 125, 175, 225, 300];

function isPendingComputerTurn(game: GameRow): boolean {
  return (
    game.game_mode === "solo" &&
    game.status === "active" &&
    game.turn_color === computerColor(game)
  );
}

async function waitForComputerTurnResolution(
  gameId: string,
  expectedVersion: number,
): Promise<GameRow | null> {
  let game = await findGameById(gameId);
  for (const delayMs of BOT_READ_RETRY_DELAYS_MS) {
    if (
      !game ||
      game.version !== expectedVersion ||
      !isPendingComputerTurn(game)
    ) {
      return game;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    game = await findGameById(gameId);
  }
  return game;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const authorization = await authorizeGameRequest(request, id);
  if (!authorization.ok) {
    return apiError(
      authorization.status,
      authorization.code,
      authorization.message,
    );
  }
  const { color } = authorization;
  let game: GameRow | null = authorization.game;
  game = await expireMultiplayerTurn(game);
  if (isPendingComputerTurn(game)) {
    const expectedVersion = game.version;
    await playPendingComputerTurn(id);
    game = await waitForComputerTurnResolution(id, expectedVersion);
    if (!game) return apiError(404, "not_found", "Game not found");
  }

  const since = new URL(request.url).searchParams.get("sinceVersion");
  if (since !== null && Number(since) === game.version) {
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  return json({ game: snapshot(game, await readMoves(id), color) });
}
