import { Chess, type Move, type PieceSymbol, type Square } from "chess.js";
import type { AiDifficulty, Color, Promotion } from "./game-types";

export interface ComputerMove {
  from: Square;
  to: Square;
  promotion?: Promotion;
}

const PIECE_VALUE: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20_000,
};

const CENTER_SQUARES = new Set(["c3", "d3", "e3", "f3", "c4", "d4", "e4", "f4", "c5", "d5", "e5", "f5", "c6", "d6", "e6", "f6"]);

function terminalScore(
  chess: Chess,
  computerColor: Color,
  plyFromRoot: number,
): number | null {
  if (chess.isCheckmate()) {
    return chess.turn() === computerColor
      ? -100_000 + plyFromRoot
      : 100_000 - plyFromRoot;
  }
  if (chess.isGameOver()) return 0;
  return null;
}

function evaluate(chess: Chess, computerColor: Color): number {
  const terminal = terminalScore(chess, computerColor, 0);
  if (terminal !== null) return terminal;
  let score = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const sign = piece.color === computerColor ? 1 : -1;
      score += sign * PIECE_VALUE[piece.type];
      if (CENTER_SQUARES.has(piece.square)) score += sign * 8;
    }
  }
  const mobility = chess.moves().length;
  score += chess.turn() === computerColor ? mobility * 2 : -mobility * 2;
  return score;
}

function movePriority(move: Move): number {
  return (move.captured ? PIECE_VALUE[move.captured] : 0)
    + (move.promotion ? PIECE_VALUE[move.promotion] : 0)
    + (move.san.includes("+") ? 40 : 0)
    + (move.san.includes("#") ? 100_000 : 0);
}

function orderedMoves(chess: Chess): Move[] {
  return chess.moves({ verbose: true }).sort((a, b) => movePriority(b) - movePriority(a));
}

function search(
  chess: Chess,
  depth: number,
  alpha: number,
  beta: number,
  plyFromRoot: number,
  deadline: number,
  computerColor: Color,
): number {
  const terminal = terminalScore(chess, computerColor, plyFromRoot);
  if (terminal !== null) return terminal;
  if (depth === 0 || performance.now() >= deadline) return evaluate(chess, computerColor);

  const maximizing = chess.turn() === computerColor;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of orderedMoves(chess)) {
    chess.move(move);
    const score = search(
      chess,
      depth - 1,
      alpha,
      beta,
      plyFromRoot + 1,
      deadline,
      computerColor,
    );
    chess.undo();
    if (maximizing) {
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, score);
      beta = Math.min(beta, best);
    }
    if (alpha >= beta || performance.now() >= deadline) break;
  }
  return best;
}

function asComputerMove(move: Move): ComputerMove {
  return {
    from: move.from,
    to: move.to,
    ...(move.promotion ? { promotion: move.promotion as Promotion } : {}),
  };
}

export function chooseComputerMove(
  fen: string,
  difficulty: AiDifficulty,
  computerColor: Color = new Chess(fen).turn(),
  random: () => number = Math.random,
): ComputerMove | null {
  const chess = new Chess(fen);
  if (chess.turn() !== computerColor) return null;
  const moves = orderedMoves(chess);
  if (moves.length === 0) return null;

  if (difficulty === 1) {
    return asComputerMove(moves[Math.floor(random() * moves.length)] ?? moves[0]);
  }

  const depth = difficulty === 2 ? 1 : difficulty === 3 ? 2 : difficulty === 4 ? 3 : 4;
  const deadline = performance.now() + (difficulty === 5 ? 550 : difficulty === 4 ? 330 : 180);
  const scored = moves.map((move) => {
    chess.move(move);
    const score = search(
      chess,
      depth - 1,
      -Infinity,
      Infinity,
      1,
      deadline,
      computerColor,
    );
    chess.undo();
    return { move, score };
  });
  scored.sort((a, b) => b.score - a.score);

  if (difficulty === 2) {
    const pool = scored.slice(0, Math.min(6, scored.length));
    return asComputerMove(pool[Math.floor(random() * pool.length)]?.move ?? scored[0].move);
  }
  if (difficulty === 3) {
    const pool = scored.slice(0, Math.min(3, scored.length));
    return asComputerMove(pool[Math.floor(random() * pool.length)]?.move ?? scored[0].move);
  }
  return asComputerMove(scored[0].move);
}
