import type { GameSnapshot, PublicMove } from "./game-types";

export interface BoardEffect {
  ply: number;
  from: string;
  to: string;
  capture: boolean;
}

export function boardEffects(
  previous: GameSnapshot | null,
  next: GameSnapshot,
): BoardEffect[] {
  if (!previous || next.plyCount <= previous.plyCount) return [];
  return next.moves
    .filter((move: PublicMove) => move.ply > previous.plyCount)
    .map((move) => ({
      ply: move.ply,
      from: move.second?.from ?? move.from,
      to: move.second?.to ?? move.to,
      capture: (move.second?.san ?? move.san).includes("x"),
    }));
}
