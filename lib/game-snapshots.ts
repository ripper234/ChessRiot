import type { Square } from "chess.js";
import { chooseComputerMove, seededComputerRandom } from "./computer-player";
import { applyCandidate, type CandidateMove } from "./game-rules";
import type { GameSnapshot, Promotion } from "./game-types";

export function shouldAcceptGameSnapshot(currentVersion: number, incomingVersion: number): boolean {
  return incomingVersion > currentVersion;
}

function appendOptimisticMove(
  current: GameSnapshot,
  candidate: CandidateMove,
  createdAt: string,
): GameSnapshot | null {
  try {
    const outcome = applyCandidate(
      current.initialFen,
      current.moves,
      candidate,
      current.magicRules ?? null,
    );
    return {
      ...current,
      // This is display-only. The server remains the sole owner of version state.
      version: current.version,
      status: outcome.completed ? "completed" : current.status,
      fen: outcome.fenAfter,
      turn: outcome.turn,
      plyCount: current.plyCount + 1,
      check: outcome.check,
      claimableDraws: [],
      outcome: outcome.termination
        ? { winner: outcome.winner, reason: outcome.termination }
        : null,
      moves: [
        ...current.moves,
        {
          ply: current.plyCount + 1,
          color: outcome.move.color,
          from: outcome.move.from,
          to: outcome.move.to,
          promotion: candidate.promotion ?? null,
          san: outcome.move.san,
          second: outcome.secondMove
            ? {
              from: outcome.secondMove.from,
              to: outcome.secondMove.to,
              san: outcome.secondMove.san,
            }
            : null,
          fenBefore: outcome.fenBefore,
          fenAfter: outcome.fenAfter,
          createdAt,
        },
      ],
      updatedAt: createdAt,
    };
  } catch {
    return null;
  }
}

export function optimisticMoveSnapshot(
  current: GameSnapshot,
  from: Square,
  to: Square,
  promotion?: Promotion,
  options: {
    second?: { from: Square; to: Square };
    createdAt?: string;
  } = {},
): GameSnapshot | null {
  if (current.status !== "active" || current.turn !== current.you.color) return null;
  return appendOptimisticMove(
    current,
    {
      from,
      to,
      ...(promotion ? { promotion } : {}),
      ...(options.second ? { second: options.second } : {}),
    },
    options.createdAt ?? new Date().toISOString(),
  );
}

export function optimisticSoloTurnSnapshot(
  current: GameSnapshot,
  from: Square,
  to: Square,
  turnSeed: string,
  promotion?: Promotion,
  options: {
    second?: { from: Square; to: Square };
    createdAt?: string;
  } = {},
): GameSnapshot | null {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const human = optimisticMoveSnapshot(
    current,
    from,
    to,
    promotion,
    {
      ...(options.second ? { second: options.second } : {}),
      createdAt,
    },
  );
  if (
    !human
    || human.mode !== "solo"
    || human.status !== "active"
    || human.aiDifficulty === null
    || human.turn === human.you.color
  ) {
    return human;
  }
  const candidate = chooseComputerMove(
    human.fen,
    human.aiDifficulty,
    human.turn,
    seededComputerRandom(turnSeed),
    human.magicRules ?? null,
  );
  if (!candidate) return human;
  return appendOptimisticMove(human, candidate, createdAt);
}
