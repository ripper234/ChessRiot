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

export function actionEndpointSquares(
  move: Pick<PublicMove, "from" | "to" | "second">,
): [string, string] {
  return [move.from, move.second?.to ?? move.to];
}

export function capturedPiecesByVictimColor(
  moves: PublicMove[],
  initialFen = new Chess().fen(),
): CapturedPieces {
  let chess = new Chess(initialFen);
  const captured: CapturedPieces = { w: [], b: [] };

  for (const stored of moves) {
    try {
      if (stored.fenBefore) chess = new Chess(stored.fenBefore);
      const first = chess.move({
        from: stored.from as Square,
        to: stored.to as Square,
        ...(stored.promotion ? { promotion: stored.promotion } : {}),
      });
      if (first.captured) {
        const capturedColor: Color = first.color === "w" ? "b" : "w";
        captured[capturedColor].push(first.captured);
      }
      if (stored.second) {
        const fields = chess.fen().split(" ");
        fields[1] = first.color;
        if (first.color === "b") {
          fields[5] = String(Math.max(1, Number(fields[5] ?? "1") - 1));
        }
        chess = new Chess(fields.join(" "));
        const second = chess.move({
          from: stored.second.from as Square,
          to: stored.second.to as Square,
        });
        if (second.captured) {
          const capturedColor: Color = second.color === "w" ? "b" : "w";
          captured[capturedColor].push(second.captured);
        }
      }
      if (stored.fenAfter) chess = new Chess(stored.fenAfter);
    } catch {
      return captured;
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
