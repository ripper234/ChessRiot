import { Chess, type Move, type Square } from "chess.js";
import {
  hasMagicRule,
  type CompiledMagicRules,
} from "./magic-rules";
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
  second?: {
    from: string;
    to: string;
  };
}

export interface MoveOutcome {
  move: Move;
  secondMove: Move | null;
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

type ReplayMove = Pick<StoredMove, "from" | "to" | "promotion">
  & {
    second?: { from: string; to: string } | null;
  }
  & Partial<Pick<StoredMove, "color" | "fenBefore" | "fenAfter">>;

export interface ReplayResult {
  chess: Chess;
  currentRepetitionCount: number;
}

function forceSameTurn(fen: string, color: Color): string {
  const fields = fen.split(" ");
  if (fields.length !== 6) throw new Error("Chess position is invalid");
  fields[1] = color;
  if (color === "b") {
    fields[5] = String(Math.max(1, Number(fields[5] ?? "1") - 1));
  }
  return fields.join(" ");
}

function normalizeActionCounters(
  chess: Chess,
  fenBefore: string,
  first: Move,
  second: Move | null,
): Chess {
  const before = fenBefore.split(" ");
  const after = chess.fen().split(" ");
  if (before.length !== 6 || after.length !== 6) {
    throw new Error("Chess position is invalid");
  }
  const resetsHalfmove = first.piece === "p"
    || Boolean(first.captured)
    || Boolean(second?.captured);
  after[4] = resetsHalfmove
    ? "0"
    : String(Number(before[4] ?? "0") + 1);
  after[5] = String(
    Number(before[5] ?? "1") + (first.color === "b" ? 1 : 0),
  );
  return new Chess(after.join(" "));
}

function moveMatchesCandidate(
  move: Move,
  candidate: Pick<CandidateMove, "from" | "to" | "promotion">,
): boolean {
  return move.from === candidate.from
    && move.to === candidate.to
    && (move.promotion ?? undefined) === candidate.promotion;
}

export function legalMagicMoves(
  chess: Chess,
  rules: CompiledMagicRules | null = null,
  square?: Square,
): Move[] {
  const moves = square
    ? chess.moves({ square, verbose: true })
    : chess.moves({ verbose: true });

  return moves.filter((move) => {
    if (move.promotion && hasMagicRule(rules, "no_promotion")) return false;
    if (
      hasMagicRule(rules, "no_castling")
      && (move.isKingsideCastle() || move.isQueensideCastle())
    ) return false;
    if (hasMagicRule(rules, "no_en_passant") && move.isEnPassant()) return false;
    if (move.captured === "k") return false;
    return true;
  });
}

export interface RookSecondStep {
  chess: Chess;
  moves: Move[];
}

export function rookSecondStep(
  chessAfterFirst: Chess,
  rookSquare: Square,
  moverColor: Color,
  rules: CompiledMagicRules | null,
): RookSecondStep | null {
  if (
    !hasMagicRule(rules, "double_move", "r")
    || chessAfterFirst.isCheck()
  ) return null;
  const rook = chessAfterFirst.get(rookSquare);
  if (rook?.type !== "r" || rook.color !== moverColor) return null;
  const chess = new Chess(forceSameTurn(chessAfterFirst.fen(), moverColor));
  const moves = legalMagicMoves(chess, rules, rookSquare)
    .filter((move) => move.piece === "r" && move.from === rookSquare);
  return moves.length > 0 ? { chess, moves } : null;
}

function applyActionToPosition(
  chess: Chess,
  candidate: CandidateMove,
  rules: CompiledMagicRules | null,
): {
  chess: Chess;
  move: Move;
  secondMove: Move | null;
  fenBefore: string;
} {
  const fenBefore = chess.fen();
  const allowed = legalMagicMoves(chess, rules, candidate.from as Square);
  const selected = allowed.find((move) => moveMatchesCandidate(move, candidate));
  if (!selected) throw new IllegalMoveError();

  let move: Move;
  try {
    move = chess.move({
      from: selected.from,
      to: selected.to,
      ...(selected.promotion ? { promotion: selected.promotion } : {}),
    });
  } catch {
    throw new IllegalMoveError();
  }

  let secondMove: Move | null = null;
  if (candidate.second) {
    if (move.piece !== "r") throw new IllegalMoveError("Only a rook can move twice");
    const secondStep = rookSecondStep(chess, move.to, move.color, rules);
    if (!secondStep || candidate.second.from !== move.to) {
      throw new IllegalMoveError("That rook cannot move twice from there");
    }
    const selectedSecond = secondStep.moves.find((candidateMove) =>
      candidateMove.from === candidate.second?.from
      && candidateMove.to === candidate.second?.to);
    if (!selectedSecond) throw new IllegalMoveError("The second rook move is not legal");
    try {
      secondMove = secondStep.chess.move({
        from: selectedSecond.from,
        to: selectedSecond.to,
      });
      chess = secondStep.chess;
    } catch {
      throw new IllegalMoveError("The second rook move is not legal");
    }
  }
  chess = normalizeActionCounters(chess, fenBefore, move, secondMove);

  return {
    chess,
    move,
    secondMove,
    fenBefore,
  };
}

export function replayWithRepetition(
  initialFen: string,
  moves: ReplayMove[],
  rules: CompiledMagicRules | null = null,
): ReplayResult {
  let chess = new Chess(initialFen);
  const counts = new Map<string, number>();
  const mark = () => {
    const key = positionKey(chess.fen());
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  mark();
  for (const stored of moves) {
    try {
      if (stored.color && stored.color !== chess.turn()) {
        throw new Error("Stored move color is invalid");
      }
      if (stored.fenBefore && stored.fenBefore !== chess.fen()) {
        throw new Error("Stored move origin is invalid");
      }
      const applied = applyActionToPosition(
        chess,
        {
          from: stored.from,
          to: stored.to,
          ...(stored.promotion ? { promotion: stored.promotion } : {}),
          ...(stored.second ? {
            second: {
              from: stored.second.from,
              to: stored.second.to,
            },
          } : {}),
        },
        rules,
      );
      chess = applied.chess;
      if (stored.fenAfter && stored.fenAfter !== chess.fen()) {
        throw new Error("Stored move result is invalid");
      }
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

export function replayGame(
  initialFen: string,
  moves: ReplayMove[],
  rules: CompiledMagicRules | null = null,
): Chess {
  return replayWithRepetition(initialFen, moves, rules).chess;
}

export function applyCandidate(
  initialFen: string,
  moves: ReplayMove[],
  candidate: CandidateMove,
  rules: CompiledMagicRules | null = null,
): MoveOutcome {
  const replayedBefore = replayWithRepetition(initialFen, moves, rules);
  let chess = replayedBefore.chess;
  const piece = chess.get(candidate.from as Square);
  const reachesPromotionRank = piece?.type === "p"
    && (candidate.to.endsWith("8") || candidate.to.endsWith("1"));
  if (candidate.promotion && !reachesPromotionRank) throw new IllegalMoveError();
  const applied = applyActionToPosition(
    chess,
    candidate,
    rules,
  );
  chess = applied.chess;
  const replayed = replayWithRepetition(initialFen, [
    ...moves,
    {
      from: candidate.from,
      to: candidate.to,
      promotion: candidate.promotion ?? null,
      second: candidate.second ?? null,
    },
  ], rules);
  const terminal = analyzeTerminal(chess, replayed.currentRepetitionCount, rules);

  return {
    move: applied.move,
    secondMove: applied.secondMove,
    fenBefore: applied.fenBefore,
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
  rules: CompiledMagicRules | null = null,
): TerminalState {
  let termination: Termination | null = null;
  let winner: Color | null = null;
  const noLegalMoves = legalMagicMoves(chess, rules).length === 0;
  if (chess.isCheck() && noLegalMoves) {
    termination = "checkmate";
    winner = chess.turn() === "w" ? "b" : "w";
  } else if (!chess.isCheck() && noLegalMoves) {
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
