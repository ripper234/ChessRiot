import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { buildReplayFrames } from "./game-replay";
import type { GameSnapshot } from "./game-types";
import {
  optimisticMoveSnapshot,
  optimisticSoloTurnSnapshot,
  shouldAcceptGameSnapshot,
} from "./game-snapshots";

function startingSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    id: "solo-game",
    mode: "solo",
    aiDifficulty: 3,
    status: "active",
    version: 7,
    initialFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    turn: "w",
    plyCount: 0,
    players: { white: { name: "Player" }, black: { name: "Riot Bot" } },
    you: { color: "w", name: "Player" },
    check: false,
    claimableDraws: [],
    outcome: null,
    moves: [],
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("shouldAcceptGameSnapshot", () => {
  it("accepts the first and newer snapshots", () => {
    expect(shouldAcceptGameSnapshot(-1, 0)).toBe(true);
    expect(shouldAcceptGameSnapshot(2, 3)).toBe(true);
  });

  it("rejects duplicate and out-of-order snapshots", () => {
    expect(shouldAcceptGameSnapshot(3, 3)).toBe(false);
    expect(shouldAcceptGameSnapshot(3, 2)).toBe(false);
  });
});

describe("optimisticMoveSnapshot", () => {
  it("shows a legal human move immediately without mutating the authoritative snapshot", () => {
    const authoritative = startingSnapshot();
    const optimistic = optimisticMoveSnapshot(
      authoritative,
      "e2",
      "e4",
      undefined,
      { createdAt: "2026-07-24T00:00:01.000Z" },
    );

    expect(optimistic).not.toBeNull();
    expect(optimistic).toMatchObject({
      version: 7,
      turn: "b",
      plyCount: 1,
      check: false,
      updatedAt: "2026-07-24T00:00:01.000Z",
    });
    expect(new Chess(optimistic!.fen).get("e4")).toEqual({
      color: "w",
      type: "p",
    });
    expect(optimistic!.moves.at(-1)).toMatchObject({
      ply: 1,
      color: "w",
      from: "e2",
      to: "e4",
      promotion: null,
      san: "e4",
    });
    expect(authoritative).toEqual(startingSnapshot());
  });

  it("shows the deterministic Solo reply before the request returns", () => {
    const authoritative = startingSnapshot({ aiDifficulty: 1 });
    const optimistic = optimisticSoloTurnSnapshot(
      authoritative,
      "e2",
      "e4",
      "turn-request",
      undefined,
      { createdAt: "2026-07-24T00:00:01.000Z" },
    );

    expect(optimistic).not.toBeNull();
    expect(optimistic).toMatchObject({
      version: 7,
      turn: "w",
      plyCount: 2,
      updatedAt: "2026-07-24T00:00:01.000Z",
    });
    expect(optimistic!.moves.map((move) => move.color)).toEqual(["w", "b"]);
    expect(new Chess(optimistic!.fen).turn()).toBe("w");
    expect(authoritative).toEqual(startingSnapshot({ aiDifficulty: 1 }));
  });

  it("returns only the human preview when that move ends the game", () => {
    const mate = startingSnapshot({
      aiDifficulty: 5,
      initialFen: "8/8/8/8/8/6K1/5Q2/7k w - - 0 1",
      fen: "8/8/8/8/8/6K1/5Q2/7k w - - 0 1",
    });
    const optimistic = optimisticSoloTurnSnapshot(
      mate,
      "f2",
      "f1",
      "turn-request",
    );

    expect(optimistic?.status).toBe("completed");
    expect(optimistic?.moves).toHaveLength(1);
  });

  it("keeps the position immediately before an optimistic move available to history", () => {
    const authoritative = startingSnapshot();
    const optimistic = optimisticMoveSnapshot(
      authoritative,
      "e2",
      "e4",
      undefined,
      { createdAt: "2026-07-24T00:00:01.000Z" },
    );
    const frames = buildReplayFrames(
      optimistic!.moves,
      optimistic!.initialFen,
    );

    expect(frames).toHaveLength(2);
    expect(new Chess(frames.at(-1)!.fen).get("e4")).toMatchObject({
      color: "w",
      type: "p",
    });
    expect(new Chess(frames.at(-2)!.fen).get("e2")).toMatchObject({
      color: "w",
      type: "p",
    });
  });

  it("refuses illegal, inactive, and out-of-turn previews", () => {
    expect(optimisticMoveSnapshot(startingSnapshot(), "e2", "e5")).toBeNull();
    expect(optimisticMoveSnapshot(
      startingSnapshot({ status: "completed" }),
      "e2",
      "e4",
    )).toBeNull();
    expect(optimisticMoveSnapshot(
      startingSnapshot({ turn: "b" }),
      "e2",
      "e4",
    )).toBeNull();
  });
});
