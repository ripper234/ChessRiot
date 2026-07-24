import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { buildReplayFrames, replayFrameLabel } from "./game-replay";
import type { PublicMove } from "./game-types";

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
});
