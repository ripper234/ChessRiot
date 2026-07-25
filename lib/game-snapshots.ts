import type { Square } from "chess.js";
import { applyCandidate } from "./game-rules";
import type { GameSnapshot, Promotion } from "./game-types";

export function shouldAcceptGameSnapshot(currentVersion: number, incomingVersion: number): boolean {
  return incomingVersion > currentVersion;
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
  try {
    const outcome = applyCandidate(current.initialFen, current.moves, {
      from,
      to,
      ...(promotion ? { promotion } : {}),
      ...(options.second ? { second: options.second } : {}),
    }, current.magicRules ?? null);
    const createdAt = options.createdAt ?? new Date().toISOString();
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
          promotion: promotion ?? null,
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
