import { describe, expect, it } from "vitest";
import type { GameSnapshot, PublicMove } from "./game-types";
import { boardEffects } from "./game-effects";

function snapshot(moves: PublicMove[]): GameSnapshot {
  return {
    id: "game",
    mode: "multiplayer",
    aiDifficulty: null,
    status: "active",
    version: moves.length,
    fen: "",
    turn: moves.length % 2 === 0 ? "w" : "b",
    plyCount: moves.length,
    players: { white: { name: "White" }, black: { name: "Black" } },
    you: { color: "w", name: "White" },
    check: false,
    claimableDraws: [],
    outcome: null,
    moves,
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
}

const moves: PublicMove[] = [
  {
    ply: 1,
    color: "w",
    from: "e2",
    to: "e4",
    promotion: null,
    san: "e4",
    createdAt: "2026-07-24T00:00:00.000Z",
  },
  {
    ply: 2,
    color: "b",
    from: "d7",
    to: "d5",
    promotion: null,
    san: "d5",
    createdAt: "2026-07-24T00:00:01.000Z",
  },
  {
    ply: 3,
    color: "w",
    from: "e4",
    to: "d5",
    promotion: null,
    san: "exd5",
    createdAt: "2026-07-24T00:00:02.000Z",
  },
];

describe("boardEffects", () => {
  it("does not animate an initial load or unchanged poll", () => {
    expect(boardEffects(null, snapshot(moves))).toEqual([]);
    expect(boardEffects(snapshot(moves), snapshot(moves))).toEqual([]);
  });

  it("returns every newly committed move and identifies captures", () => {
    expect(boardEffects(snapshot(moves.slice(0, 1)), snapshot(moves))).toEqual([
      { ply: 2, from: "d7", to: "d5", capture: false },
      { ply: 3, from: "e4", to: "d5", capture: true },
    ]);
  });

  it("animates an optimistic human move first and only the bot reply afterward", () => {
    const before = snapshot([]);
    const humanPreview = snapshot(moves.slice(0, 1));
    const committedHuman = {
      ...humanPreview,
      version: humanPreview.version + 1,
    };
    const finalReply = snapshot(moves.slice(0, 2));

    expect(boardEffects(before, humanPreview)).toEqual([
      { ply: 1, from: "e2", to: "e4", capture: false },
    ]);
    expect(boardEffects(humanPreview, committedHuman)).toEqual([]);
    expect(boardEffects(committedHuman, finalReply)).toEqual([
      { ply: 2, from: "d7", to: "d5", capture: false },
    ]);
  });
});
