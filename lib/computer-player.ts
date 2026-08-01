import { Chess, type Move, type PieceSymbol, type Square } from "chess.js";
import { legalMagicMoves, magicSecondStep } from "./game-rules";
import type { CompiledMagicRules } from "./magic-rules";
import type { AiDifficulty, Color, Promotion } from "./game-types";

export interface ComputerMove {
  from: Square;
  to: Square;
  promotion?: Promotion;
  second?: {
    from: Square;
    to: Square;
  };
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

interface SearchBudget {
  maxNodes: number;
  visitedNodes: number;
}

// A node budget is deterministic across browsers and Workers. Time-based
// cutoffs produce different moves because Workers freeze elapsed-time clocks
// during CPU-only work.
const SEARCH_NODE_BUDGET: Record<Exclude<AiDifficulty, 1>, number> = {
  2: 64,
  3: 768,
  4: 1_100,
  5: 1_200,
};

export function seededComputerRandom(seed: string): () => number {
  let state = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16_777_619);
  }
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

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
  if (chess.isDraw()) return 0;
  return null;
}

function evaluate(chess: Chess, computerColor: Color): number {
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
  budget: SearchBudget,
  computerColor: Color,
): number {
  budget.visitedNodes += 1;
  const terminal = terminalScore(chess, computerColor, plyFromRoot);
  if (terminal !== null) return terminal;
  if (
    depth === 0
    || budget.visitedNodes >= budget.maxNodes
  ) return evaluate(chess, computerColor);

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
      budget,
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
    if (
      alpha >= beta
      || budget.visitedNodes >= budget.maxNodes
    ) break;
  }
  return best;
}

function asComputerMove(
  move: Move,
  rootFen: string,
  rules: CompiledMagicRules | null,
  random: () => number,
  randomSecond: boolean,
): ComputerMove {
  const candidate: ComputerMove = {
    from: move.from,
    to: move.to,
    ...(move.promotion ? { promotion: move.promotion as Promotion } : {}),
  };
  if (move.piece !== "r" && move.piece !== "n") return candidate;
  const afterFirst = new Chess(rootFen);
  afterFirst.move(move);
  const secondStep = magicSecondStep(afterFirst, move.to, move.color, rules);
  if (!secondStep) return candidate;
  const ordered = [...secondStep.moves]
    .sort((left, right) => movePriority(right) - movePriority(left));
  const second = randomSecond
    ? ordered[Math.floor(random() * ordered.length)] ?? ordered[0]
    : ordered[0];
  return second
    ? {
      ...candidate,
      second: { from: second.from, to: second.to },
    }
    : candidate;
}

export function chooseComputerMove(
  fen: string,
  difficulty: AiDifficulty,
  computerColor: Color = new Chess(fen).turn(),
  random: () => number = Math.random,
  rules: CompiledMagicRules | null = null,
): ComputerMove | null {
  const chess = new Chess(fen);
  if (chess.turn() !== computerColor) return null;
  const moves = legalMagicMoves(chess, rules)
    .sort((a, b) => movePriority(b) - movePriority(a));
  if (moves.length === 0) return null;

  if (difficulty === 1) {
    return asComputerMove(
      moves[Math.floor(random() * moves.length)] ?? moves[0],
      fen,
      rules,
      random,
      true,
    );
  }

  // Checkmating SAN is already produced by chess.js and ordered first. Avoid
  // spending the full search budget after a forced one-ply win is known.
  const immediateMate = moves.find((move) => move.san.includes("#"));
  if (immediateMate) {
    return asComputerMove(immediateMate, fen, rules, random, false);
  }

  const depth = difficulty === 2 ? 1 : difficulty === 3 ? 2 : difficulty === 4 ? 3 : 4;
  const budget: SearchBudget = {
    maxNodes: SEARCH_NODE_BUDGET[difficulty],
    visitedNodes: 0,
  };
  const scored = moves.map((move) => {
    chess.move(move);
    const score = search(
      chess,
      depth - 1,
      -Infinity,
      Infinity,
      1,
      budget,
      computerColor,
    );
    chess.undo();
    return { move, score };
  });
  scored.sort((a, b) => b.score - a.score);

  if (difficulty === 2) {
    const pool = scored.slice(0, Math.min(6, scored.length));
    return asComputerMove(
      pool[Math.floor(random() * pool.length)]?.move ?? scored[0].move,
      fen,
      rules,
      random,
      true,
    );
  }
  if (difficulty === 3) {
    const pool = scored.slice(0, Math.min(3, scored.length));
    return asComputerMove(
      pool[Math.floor(random() * pool.length)]?.move ?? scored[0].move,
      fen,
      rules,
      random,
      false,
    );
  }
  return asComputerMove(scored[0].move, fen, rules, random, false);
}
