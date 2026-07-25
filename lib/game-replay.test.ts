import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { applyCandidate, INITIAL_FEN, type CandidateMove } from "./game-rules";
import {
  buildReplayFrames,
  nextHistoryCursor,
  previousHistoryCursor,
  replayFrameLabel,
  resolvedHistoryPly,
} from "./game-replay";
import type { PublicMove } from "./game-types";
import type { CompiledMagicRules } from "./magic-rules";

function move(
  ply: number,
  color: "w" | "b",
  from: string,
  to: string,
  san: string,
): PublicMove {
  return {
    ply,
    color,
    from,
    to,
    promotion: null,
    san,
    createdAt: "2026-07-24T12:00:00.000Z",
  };
}

describe("game replay", () => {
  it("builds one immutable position for the start and every ply", () => {
    const frames = buildReplayFrames([
      move(1, "w", "e2", "e4", "e4"),
      move(2, "b", "c7", "c5", "c5"),
      move(3, "w", "g1", "f3", "Nf3"),
    ]);

    expect(frames).toHaveLength(4);
    expect(replayFrameLabel(frames[0])).toBe("Start position");
    expect(replayFrameLabel(frames[2])).toBe("Move 1, Black: c5");
    expect(replayFrameLabel(frames[3])).toBe("Move 2, White: Nf3");

    expect(new Chess(frames[0].fen).get("e2")).toMatchObject({ color: "w", type: "p" });
    expect(new Chess(frames[1].fen).get("e4")).toMatchObject({ color: "w", type: "p" });
    expect(new Chess(frames[2].fen).get("c5")).toMatchObject({ color: "b", type: "p" });
    expect(new Chess(frames[3].fen).get("f3")).toMatchObject({ color: "w", type: "n" });
  });

  it("rejects incomplete or illegal public histories without altering a game", () => {
    expect(() => buildReplayFrames([
      move(2, "w", "e2", "e4", "e4"),
    ])).toThrow("Game history cannot be replayed");

    expect(() => buildReplayFrames([
      move(1, "w", "e2", "e5", "e5"),
    ])).toThrow("Game history cannot be replayed");
  });

  it("replays an atomic two-step rook action as one labeled turn", () => {
    const rules: CompiledMagicRules = {
      version: 1,
      rules: [{ kind: "double_move", piece: "r" }],
    };
    const candidates: CandidateMove[] = [
      { from: "a2", to: "a4" },
      { from: "h7", to: "h6" },
      {
        from: "a1",
        to: "a3",
        second: { from: "a3", to: "h3" },
      },
    ];
    const history: PublicMove[] = [];
    for (const candidate of candidates) {
      const outcome = applyCandidate(
        INITIAL_FEN,
        history,
        candidate,
        rules,
      );
      history.push({
        ply: history.length + 1,
        color: outcome.move.color,
        from: outcome.move.from,
        to: outcome.move.to,
        promotion: (outcome.move.promotion as PublicMove["promotion"]) ?? null,
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
        createdAt: "2026-07-25T00:00:00.000Z",
      });
    }
    const frames = buildReplayFrames(history);
    const rookMove = history[2];

    expect(frames).toHaveLength(4);
    expect(frames[3]).toMatchObject({
      from: "a1",
      to: "h3",
      san: `${rookMove.san} → ${rookMove.second!.san}`,
    });
    expect(new Chess(frames[3].fen).get("h3")).toMatchObject({
      color: "w",
      type: "r",
    });
  });

  it("replays an atomic two-step knight action as one labeled turn", () => {
    const rules: CompiledMagicRules = {
      version: 2,
      rules: [{ kind: "double_move", piece: "n" }],
    };
    const outcome = applyCandidate(
      INITIAL_FEN,
      [],
      {
        from: "g1",
        to: "f3",
        second: { from: "f3", to: "e5" },
      },
      rules,
    );
    const history: PublicMove[] = [{
      ply: 1,
      color: outcome.move.color,
      from: outcome.move.from,
      to: outcome.move.to,
      promotion: null,
      san: outcome.move.san,
      second: {
        from: outcome.secondMove!.from,
        to: outcome.secondMove!.to,
        san: outcome.secondMove!.san,
      },
      fenBefore: outcome.fenBefore,
      fenAfter: outcome.fenAfter,
      createdAt: "2026-07-25T00:00:00.000Z",
    }];
    const frames = buildReplayFrames(history);

    expect(frames).toHaveLength(2);
    expect(frames[1]).toMatchObject({
      from: "g1",
      to: "e5",
      san: `${outcome.move.san} → ${outcome.secondMove!.san}`,
    });
    expect(new Chess(frames[1].fen).get("e5")).toMatchObject({
      color: "w",
      type: "n",
    });
  });

  it("replays from the game's actual initial position", () => {
    const initial = new Chess();
    initial.move("e4");
    const frames = buildReplayFrames([
      move(1, "b", "c7", "c5", "c5"),
    ], initial.fen());

    expect(frames[0].fen).toBe(initial.fen());
    expect(new Chess(frames[1].fen).get("c5")).toMatchObject({
      color: "b",
      type: "p",
    });
  });

  it("keeps a historical cursor pinned while new moves arrive and returns forward to live", () => {
    let cursor = previousHistoryCursor(null, 4);
    expect(cursor).toBe(3);
    expect(resolvedHistoryPly(cursor, 6)).toBe(3);

    cursor = nextHistoryCursor(cursor, 6);
    expect(cursor).toBe(4);
    cursor = nextHistoryCursor(cursor, 6);
    expect(cursor).toBe(5);
    cursor = nextHistoryCursor(cursor, 6);
    expect(cursor).toBeNull();
    expect(resolvedHistoryPly(cursor, 6)).toBe(6);
  });

  it("bounds history navigation at the start and disables it for an empty game", () => {
    expect(previousHistoryCursor(null, 0)).toBeNull();
    expect(previousHistoryCursor(0, 5)).toBe(0);
    expect(nextHistoryCursor(null, 5)).toBeNull();
    expect(resolvedHistoryPly(99, 5)).toBe(5);
  });
});
