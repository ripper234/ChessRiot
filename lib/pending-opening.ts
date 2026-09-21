import type { Color, GameSnapshot } from "./game-types";

/** One White turn may be saved while a day-paced invitation awaits acceptance. */
export function canPlayPendingOpening(
  game: Partial<Pick<GameSnapshot, "mode" | "status" | "turnPaceDays" | "plyCount" | "turn">>,
  color: Color,
): boolean {
  return game.mode === "multiplayer" && game.status === "waiting"
    && (game.turnPaceDays === 1 || game.turnPaceDays === 3 || game.turnPaceDays === 5)
    && color === "w" && game.turn === "w" && game.plyCount === 0;
}
