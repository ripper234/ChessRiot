import { Chess, type PieceSymbol, type Square } from "chess.js";
import type { Color, GameSnapshot } from "./game-types";

export interface GameFinisher {
  type: "checkmate";
  winner: Color;
  loser: Color;
  attackingPiece: PieceSymbol;
  attackingFrom: Square;
  attackingTo: Square;
  losingKingSquare: Square;
}

export function classifyGameFinisher(
  previous: GameSnapshot | null,
  next: GameSnapshot,
): GameFinisher | null {
  if (
    !previous
    || previous.status !== "active"
    || next.status !== "completed"
    || next.outcome?.reason !== "checkmate"
    || !next.outcome.winner
    || next.plyCount <= previous.plyCount
  ) return null;

  const lastMove = next.moves.at(-1);
  if (
    !lastMove
    || lastMove.ply <= previous.plyCount
    || lastMove.color !== next.outcome.winner
  ) return null;

  try {
    const position = new Chess(next.fen);
    const attackingTo = lastMove.to as Square;
    const attackingPiece = position.get(attackingTo);
    const loser: Color = next.outcome.winner === "w" ? "b" : "w";
    const losingKing = position.board()
      .flat()
      .find((piece) => piece?.type === "k" && piece.color === loser);

    if (
      !attackingPiece
      || attackingPiece.color !== next.outcome.winner
      || !losingKing
    ) return null;

    return {
      type: "checkmate",
      winner: next.outcome.winner,
      loser,
      attackingPiece: attackingPiece.type,
      attackingFrom: lastMove.from as Square,
      attackingTo,
      losingKingSquare: losingKing.square,
    };
  } catch {
    return null;
  }
}
