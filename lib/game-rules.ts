import { Chess, type Move, type Square } from "chess.js";
import type {
  Color,
  DrawClaim,
  Promotion,
  StoredMove,
  Termination,
} from "./game-types";

export const INITIAL_FEN = new Chess().fen();

export interface CandidateMove {
  from: string;
  to: string;
  promotion?: Promotion;
}

export interface MoveOutcome {
  move: Move;
  fenBefore: string;
  fenAfter: string;
  turn: Color;
  check: boolean;
  completed: boolean;
  winner: Color | null;
  termination: Termination | null;
}

export interface TerminalState {
  completed: boolean;
  winner: Color | null;
  termination: Termination | null;
}

function positionKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

function halfmoveClock(chess: Chess): number {
  return Number(chess.fen().split(" ")[4] ?? "0");
}

export function replayWithRepetition(
  initialFen: string,
  moves: Pick<StoredMove, "from" | "to" | "promotion">[],
): { chess: Chess; currentRepetitionCount: number } {
  const chess = new Chess(initialFen);
  const counts = new Map<string, number>();
  const mark = () => {
    const key = positionKey(chess.fen());
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  mark();
  for (const stored of moves) {
    try {
      chess.move({
        from: stored.from as Square,
        to: stored.to as Square,
        ...(stored.promotion ? { promotion: stored.promotion } : {}),
      });
      mark();
    } catch {
      throw new Error("Stored move history is invalid");
    }
  }
  return {
    chess,
    currentRepetitionCount: counts.get(positionKey(chess.fen())) ?? 1,
  };
}

export class IllegalMoveError extends Error {
  constructor(message = "Illegal move") {
    super(message);
    this.name = "IllegalMoveError";
  }
}

export function replayGame(initialFen: string, moves: Pick<StoredMove, "from" | "to" | "promotion">[]): Chess {
  return replayWithRepetition(initialFen, moves).chess;
}

export function applyCandidate(
  initialFen: string,
  moves: Pick<StoredMove, "from" | "to" | "promotion">[],
  candidate: CandidateMove,
): MoveOutcome {
  const chess = replayGame(initialFen, moves);
  const fenBefore = chess.fen();
  const piece = chess.get(candidate.from as Square);
  const reachesPromotionRank = piece?.type === "p"
    && (candidate.to.endsWith("8") || candidate.to.endsWith("1"));
  if (candidate.promotion && !reachesPromotionRank) throw new IllegalMoveError();
  let move: Move;
  try {
    move = chess.move({
      from: candidate.from as Square,
      to: candidate.to as Square,
      ...(candidate.promotion ? { promotion: candidate.promotion } : {}),
    });
  } catch {
    throw new IllegalMoveError();
  }

  const replayed = replayWithRepetition(initialFen, [
    ...moves,
    {
      from: candidate.from,
      to: candidate.to,
      promotion: candidate.promotion ?? null,
    },
  ]);
  const terminal = analyzeTerminal(chess, replayed.currentRepetitionCount);

  return {
    move,
    fenBefore,
    fenAfter: chess.fen(),
    turn: chess.turn(),
    check: chess.isCheck(),
    completed: terminal.completed,
    winner: terminal.winner,
    termination: terminal.termination,
  };
}

export function analyzeTerminal(
  chess: Chess,
  currentRepetitionCount = 1,
): TerminalState {
  let termination: Termination | null = null;
  let winner: Color | null = null;
  if (chess.isCheckmate()) {
    termination = "checkmate";
    winner = chess.turn() === "w" ? "b" : "w";
  } else if (chess.isStalemate()) {
    termination = "stalemate";
  } else if (chess.isInsufficientMaterial()) {
    termination = "insufficient_material";
  } else if (currentRepetitionCount >= 5) {
    termination = "fivefold_repetition";
  } else if (halfmoveClock(chess) >= 150) {
    termination = "seventy_five_move";
  } else if (chess.isDraw()) {
    // chess.js groups claimable and automatic draws together. Claimable
    // threefold/fifty-move positions remain active until a player claims.
    if (!chess.isThreefoldRepetition() && !chess.isDrawByFiftyMoves()) {
      termination = "draw";
    }
  }
  return { completed: termination !== null, winner, termination };
}

export function claimableDraws(
  chess: Chess,
  currentRepetitionCount = 1,
): DrawClaim[] {
  const claims: DrawClaim[] = [];
  if (currentRepetitionCount >= 3) claims.push("threefold_repetition");
  if (halfmoveClock(chess) >= 100) claims.push("fifty_move");
  return claims;
}

export function isSquare(value: unknown): value is Square {
  return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}

export function isPromotion(value: unknown): value is Promotion {
  return value === "q" || value === "r" || value === "b" || value === "n";
}
