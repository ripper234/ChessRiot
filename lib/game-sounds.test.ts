import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "./game-types";
import { classifyGameSound } from "./game-sounds";

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    id: "game-1",
    status: "active",
    version: 1,
    fen: "start",
    turn: "b",
    plyCount: 1,
    players: { white: { name: "Ron" }, black: { name: "Omri" } },
    you: { color: "w", name: "Ron" },
    check: false,
    outcome: null,
    moves: [{
      ply: 1,
      color: "w",
      from: "e2",
      to: "e4",
      promotion: null,
      san: "e4",
      createdAt: "2026-07-23T00:00:00.000Z",
    }],
    updatedAt: "2026-07-23T00:00:00.000Z",
    ...overrides,
  };
}

describe("classifyGameSound", () => {
  it("stays silent on first load, duplicate polls, and join-only versions", () => {
    const current = snapshot();
    expect(classifyGameSound(null, current)).toBeNull();
    expect(classifyGameSound(current, current)).toBeNull();
    expect(classifyGameSound(current, snapshot({ version: 2, plyCount: 1 }))).toBeNull();
  });

  it("classifies moves, captures, and checks", () => {
    const previous = snapshot({ version: 1, plyCount: 0, moves: [] });
    expect(classifyGameSound(previous, snapshot({ version: 2, plyCount: 1 }))).toBe("move");
    expect(classifyGameSound(previous, snapshot({
      version: 2,
      plyCount: 1,
      moves: [{ ...snapshot().moves[0], san: "Bxh7+" }],
    }))).toBe("capture");
    expect(classifyGameSound(previous, snapshot({ version: 2, plyCount: 1, check: true }))).toBe("check");
  });

  it("classifies game endings from the current player's perspective", () => {
    const previous = snapshot({ version: 3, plyCount: 3 });
    expect(classifyGameSound(previous, snapshot({
      version: 4, plyCount: 4, status: "completed", outcome: { winner: "w", reason: "checkmate" },
    }))).toBe("victory");
    expect(classifyGameSound(previous, snapshot({
      version: 4, plyCount: 4, status: "completed", outcome: { winner: "b", reason: "checkmate" },
    }))).toBe("defeat");
    expect(classifyGameSound(previous, snapshot({
      version: 4, plyCount: 4, status: "completed", outcome: { winner: null, reason: "stalemate" },
    }))).toBe("draw");
  });
});
