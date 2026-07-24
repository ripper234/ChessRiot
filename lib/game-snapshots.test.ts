import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "./game-types";
import { optimisticMoveSnapshot, shouldAcceptGameSnapshot } from "./game-snapshots";

function startingSnapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    id: "solo-game",
    mode: "solo",
    aiDifficulty: 3,
    status: "active",
    version: 7,
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
      "2026-07-24T00:00:01.000Z",
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
