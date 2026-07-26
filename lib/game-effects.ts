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
    .map((move) => {
      const final = move.continuation?.at(-1) ?? move.second;
      return {
        ply: move.ply,
        from: final?.from ?? move.from,
        to: final?.to ?? move.to,
        capture: (final?.san ?? move.san).includes("x"),
      };
    });
}
