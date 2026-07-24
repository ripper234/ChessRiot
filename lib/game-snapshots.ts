import { Chess, type Square } from "chess.js";
import type { GameSnapshot, Promotion } from "./game-types";

export function shouldAcceptGameSnapshot(currentVersion: number, incomingVersion: number): boolean {
  return incomingVersion > currentVersion;
}

export function optimisticMoveSnapshot(
  current: GameSnapshot,
  from: Square,
  to: Square,
  promotion?: Promotion,
  createdAt = new Date().toISOString(),
): GameSnapshot | null {
  if (current.status !== "active" || current.turn !== current.you.color) return null;
  const position = new Chess(current.fen);
  try {
    const move = position.move({
      from,
      to,
      ...(promotion ? { promotion } : {}),
    });
    return {
      ...current,
      // This is display-only. The server remains the sole owner of version state.
      version: current.version,
      fen: position.fen(),
      turn: position.turn(),
      plyCount: current.plyCount + 1,
      check: position.isCheck(),
      claimableDraws: [],
      outcome: null,
      moves: [
        ...current.moves,
        {
          ply: current.plyCount + 1,
          color: move.color,
          from: move.from,
          to: move.to,
          promotion: promotion ?? null,
          san: move.san,
          createdAt,
        },
      ],
      updatedAt: createdAt,
    };
  } catch {
    return null;
  }
}
