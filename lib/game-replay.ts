import { Chess, type Square } from "chess.js";
import type { Color, PublicMove } from "./game-types";

export interface ReplayFrame {
  ply: number;
  fen: string;
  san: string | null;
  mover: Color | null;
  moveNumber: number;
  from: string | null;
  to: string | null;
}

type ReplayMove = Pick<
  PublicMove,
  "ply" | "color" | "from" | "to" | "promotion" | "san" | "second" | "fenBefore" | "fenAfter"
>;

/**
 * Reconstructs immutable client-side positions from the public move log.
 * This never reads from or writes to the game API.
 */
export function buildReplayFrames(
  moves: ReplayMove[],
  initialFen?: string,
): ReplayFrame[] {
  let chess = initialFen ? new Chess(initialFen) : new Chess();
  const frames: ReplayFrame[] = [{
    ply: 0,
    fen: chess.fen(),
    san: null,
    mover: null,
    moveNumber: 0,
    from: null,
    to: null,
  }];

  for (const stored of moves) {
    if (
      stored.ply !== frames.length
      || stored.color !== chess.turn()
      || (stored.fenBefore && stored.fenBefore !== chess.fen())
    ) {
      throw new Error("Game history cannot be replayed");
    }

    try {
      let san = stored.san;
      if (stored.fenAfter) {
        chess = new Chess(stored.fenAfter);
        if (chess.turn() === stored.color) throw new Error("Turn did not advance");
        if (stored.second) san = `${stored.san} → ${stored.second.san}`;
      } else {
        const move = chess.move({
          from: stored.from as Square,
          to: stored.to as Square,
          ...(stored.promotion ? { promotion: stored.promotion } : {}),
        });
        san ||= move.san;
      }
      frames.push({
        ply: stored.ply,
        fen: chess.fen(),
        san,
        mover: stored.color,
        moveNumber: Math.ceil(stored.ply / 2),
        from: stored.from,
        to: stored.second?.to ?? stored.to,
      });
    } catch {
      throw new Error("Game history cannot be replayed");
    }
  }

  return frames;
}

export function replayFrameLabel(frame: ReplayFrame): string {
  if (frame.ply === 0) return "Start position";
  const side = frame.mover === "w" ? "White" : "Black";
  return `Move ${frame.moveNumber}, ${side}: ${frame.san ?? "move"}`;
}

export type HistoryCursor = number | null;

export function resolvedHistoryPly(
  cursor: HistoryCursor,
  latestPly: number,
): number {
  const safeLatest = Math.max(0, latestPly);
  if (cursor === null) return safeLatest;
  return Math.max(0, Math.min(cursor, safeLatest));
}

export function previousHistoryCursor(
  cursor: HistoryCursor,
  latestPly: number,
  hasVisibleDraft = false,
): HistoryCursor {
  if (cursor === null && hasVisibleDraft) return Math.max(0, latestPly);
  const current = resolvedHistoryPly(cursor, latestPly);
  if (current === 0) return latestPly === 0 ? null : 0;
  return current - 1;
}

export function nextHistoryCursor(
  cursor: HistoryCursor,
  latestPly: number,
): HistoryCursor {
  if (cursor === null) return null;
  const current = resolvedHistoryPly(cursor, latestPly);
  return current >= Math.max(0, latestPly) - 1 ? null : current + 1;
}
