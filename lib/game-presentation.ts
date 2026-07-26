import { Chess, type PieceSymbol, type Square } from "chess.js";
import type {
  AiDifficulty,
  Color,
  GameSnapshot,
  Promotion,
  PublicMove,
} from "./game-types";

export type CapturedPieces = Record<Color, PieceSymbol[]>;

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;
export const CHESS_PIECE_GLYPHS: Record<Color, Record<PieceSymbol, string>> = {
  w: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};
export const CHESS_PIECE_NAMES: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
export const DIFFICULTY_LABELS: Record<AiDifficulty, string> = {
  1: "Easy",
  2: "Relaxed",
  3: "Medium",
  4: "Tough",
  5: "Brutal",
};
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

export function orientedBoardSquares(orientation: Color): Square[] {
  const files = orientation === "w" ? FILES : [...FILES].reverse();
  const ranks = orientation === "w" ? RANKS : [...RANKS].reverse();
  return ranks.flatMap((rank) =>
    files.map((file) => `${file}${rank}` as Square),
  );
}

export function outcomeText(game: GameSnapshot): string {
  if (!game.outcome) return "";
  if (
    game.outcome.reason === "checkmate"
    || game.outcome.reason === "resignation"
    || game.outcome.reason === "timeout"
  ) {
    const winner = game.outcome.winner === "w"
      ? game.players.white.name
      : game.players.black?.name;
    const ending = game.outcome.reason === "timeout"
      ? "on time"
      : `by ${game.outcome.reason}`;
    return `${winner ?? "Winner"} wins ${ending}`;
  }
  if (game.outcome.reason === "cancelled") return "Game cancelled";
  const labels: Record<string, string> = {
    stalemate: "Draw by stalemate",
    threefold_repetition: "Draw by repetition",
    insufficient_material: "Draw by insufficient material",
    fifty_move: "Draw by the fifty-move rule",
    fivefold_repetition: "Draw by automatic fivefold repetition",
    seventy_five_move: "Draw by the seventy-five-move rule",
    draw: "Draw",
  };
  return labels[game.outcome.reason] ?? "Game over";
}

interface GameStatusTextInput {
  game: GameSnapshot;
  viewingHistory: boolean;
  historyLabel: string;
  openingIntro: boolean;
  magicPiece?: PieceSymbol | null;
  displayCheck: boolean;
}

export function gameStatusText(input: GameStatusTextInput): string {
  const {
    game,
    viewingHistory,
    historyLabel,
    openingIntro,
    magicPiece,
    displayCheck,
  } = input;
  if (viewingHistory) return historyLabel;
  if (game.status === "waiting") return "Waiting for Player 2";
  if (openingIntro) return "White opens";
  if (game.status === "completed") return outcomeText(game);
  if (magicPiece) {
    return `Magic turn: move that ${CHESS_PIECE_NAMES[magicPiece]} again or finish`;
  }
  const turnName = game.turn === "w"
    ? game.players.white.name
    : game.players.black?.name ?? "Black";
  if (displayCheck) {
    return game.turn === game.you.color
      ? "CHECK! Protect your king"
      : `${turnName} is in check`;
  }
  return game.turn === game.you.color
    ? "Your turn"
    : `${turnName}’s turn`;
}

export function actionEndpointSquares(
  move: Pick<PublicMove, "from" | "to" | "second" | "continuation">,
): [string, string] {
  return [
    move.from,
    move.continuation?.at(-1)?.to ?? move.second?.to ?? move.to,
  ];
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
      const continuation = stored.continuation
        ?? (stored.second ? [stored.second] : []);
      for (const leg of continuation) {
        const promotion = "promotion" in leg && typeof leg.promotion === "string"
          ? leg.promotion as Promotion
          : undefined;
        const fields = chess.fen().split(" ");
        fields[1] = first.color;
        if (first.color === "b") {
          fields[5] = String(Math.max(1, Number(fields[5] ?? "1") - 1));
        }
        chess = new Chess(fields.join(" "));
        const continued = chess.move({
          from: leg.from as Square,
          to: leg.to as Square,
          ...(promotion ? { promotion } : {}),
        });
        if (continued.captured) {
          const capturedColor: Color = continued.color === "w" ? "b" : "w";
          captured[capturedColor].push(continued.captured);
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
