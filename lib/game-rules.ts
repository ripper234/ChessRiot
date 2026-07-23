import { Chess, type Move, type Square } from "chess.js";
import type { Color, Promotion, StoredMove, Termination } from "./game-types";

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

export class IllegalMoveError extends Error {
  constructor(message = "Illegal move") {
    super(message);
    this.name = "IllegalMoveError";
  }
}

export function replayGame(initialFen: string, moves: Pick<StoredMove, "from" | "to" | "promotion">[]): Chess {
  const chess = new Chess(initialFen);
  for (const stored of moves) {
    try {
      chess.move({
        from: stored.from as Square,
        to: stored.to as Square,
        ...(stored.promotion ? { promotion: stored.promotion } : {}),
      });
    } catch {
      throw new Error("Stored move history is invalid");
    }
  }
  return chess;
}

export function applyCandidate(
  initialFen: string,
  moves: Pick<StoredMove, "from" | "to" | "promotion">[],
  candidate: CandidateMove,
): MoveOutcome {
  const chess = replayGame(initialFen, moves);
  const fenBefore = chess.fen();
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

  const terminal = analyzeTerminal(chess);

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

export function analyzeTerminal(chess: Chess): TerminalState {
  let termination: Termination | null = null;
  let winner: Color | null = null;
  if (chess.isCheckmate()) {
    termination = "checkmate";
    winner = chess.turn() === "w" ? "b" : "w";
  } else if (chess.isStalemate()) {
    termination = "stalemate";
  } else if (chess.isInsufficientMaterial()) {
    termination = "insufficient_material";
  } else if (chess.isThreefoldRepetition()) {
    termination = "threefold_repetition";
  } else if (chess.isDrawByFiftyMoves()) {
    termination = "fifty_move";
  } else if (chess.isDraw()) {
    termination = "draw";
  }
  return { completed: termination !== null, winner, termination };
}

export function isSquare(value: unknown): value is Square {
  return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}

export function isPromotion(value: unknown): value is Promotion {
  return value === "q" || value === "r" || value === "b" || value === "n";
}
