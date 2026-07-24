import { Chess, type PieceSymbol, type Square } from "chess.js";
import type { Color, PublicMove } from "./game-types";

export type CapturedPieces = Record<Color, PieceSymbol[]>;

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const CAPTURE_ORDER: Record<PieceSymbol, number> = {
  q: 0,
  r: 1,
  b: 2,
  n: 3,
  p: 4,
  k: 5,
};

export function isDarkSquare(square: Square): boolean {
  const file = FILES.indexOf(square[0] as typeof FILES[number]);
  return (file + Number(square[1])) % 2 === 1;
}

export function capturedPiecesByVictimColor(
  moves: PublicMove[],
  initialFen = new Chess().fen(),
): CapturedPieces {
  const chess = new Chess(initialFen);
  const captured: CapturedPieces = { w: [], b: [] };

  for (const stored of moves) {
    let move;
    try {
      move = chess.move({
        from: stored.from as Square,
        to: stored.to as Square,
        ...(stored.promotion ? { promotion: stored.promotion } : {}),
      });
    } catch {
      return captured;
    }
    if (move.captured) {
      const capturedColor: Color = move.color === "w" ? "b" : "w";
      captured[capturedColor].push(move.captured);
    }
  }

  captured.w.sort((left, right) => CAPTURE_ORDER[left] - CAPTURE_ORDER[right]);
  captured.b.sort((left, right) => CAPTURE_ORDER[left] - CAPTURE_ORDER[right]);
  return captured;
}

export function checkedKingSquare(chess: Chess): Square | null {
  if (!chess.isCheck()) return null;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (piece?.type === "k" && piece.color === chess.turn()) return piece.square;
    }
  }
  return null;
}

export function illegalDestinationMessage(inCheck: boolean): string {
  return inCheck
    ? "You are in check. Move the king, capture the attacker, or block the attack."
    : "Choose one of the highlighted squares.";
}

export function pieceCannotAnswerCheckMessage(): string {
  return "That piece cannot stop the check. Move the king, capture the attacker, or block the attack.";
}
