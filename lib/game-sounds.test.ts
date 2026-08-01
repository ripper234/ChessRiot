import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "./game-types";
import {
  classifyGameSound,
  classifyGameSounds,
  gameSoundTimeline,
} from "./game-sounds";

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    id: "game-1",
    mode: "multiplayer",
    variantId: "standard",
    aiDifficulty: null,
    status: "active",
    version: 1,
    initialFen: "start",
    fen: "start",
    turn: "b",
    plyCount: 1,
    players: { white: { name: "Ron" }, black: { name: "Omri" } },
    you: { color: "w", name: "Ron" },
    check: false,
    claimableDraws: [],
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
    }))).toBe("check");
    expect(classifyGameSound(previous, snapshot({ version: 2, plyCount: 1, check: true }))).toBe("check");
  });

  it("classifies castling and a captured queen as distinct events", () => {
    const castleBefore = snapshot({ version: 1, plyCount: 0, moves: [] });
    expect(classifyGameSound(castleBefore, snapshot({
      version: 2,
      plyCount: 1,
      moves: [{ ...snapshot().moves[0], san: "O-O" }],
    }))).toBe("castle");

    const queenBeforeFen = "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1";
    const previous = snapshot({ version: 1, plyCount: 0, fen: queenBeforeFen, moves: [] });
    expect(classifyGameSound(previous, snapshot({
      version: 2,
      plyCount: 1,
      moves: [{
        ...snapshot().moves[0],
        from: "e4",
        to: "d5",
        san: "exd5",
        fenBefore: queenBeforeFen,
      }],
    }))).toBe("queen_capture");
  });

  it("gives each promotion its own musical event", () => {
    const previous = snapshot({ version: 1, plyCount: 0, moves: [] });
    for (const promotion of ["q", "r", "b", "n"] as const) {
      expect(classifyGameSound(previous, snapshot({
        version: 2,
        plyCount: 1,
        moves: [{ ...snapshot().moves[0], promotion, san: `e8=${promotion.toUpperCase()}` }],
      }))).toBe(`promotion_${promotion}`);
    }
  });

  it("keeps simultaneous promotion, queen capture, and check celebrations", () => {
    const fen = "4k2q/6P1/8/8/8/8/8/4K3 w - - 0 1";
    const previous = snapshot({ version: 1, plyCount: 0, fen, moves: [] });
    expect(classifyGameSounds(previous, snapshot({
      version: 2,
      plyCount: 1,
      check: true,
      moves: [{
        ...snapshot().moves[0],
        from: "g7",
        to: "h8",
        promotion: "q",
        san: "gxh8=Q+",
        fenBefore: fen,
      }],
    }))).toEqual(["promotion_q", "queen_capture", "check"]);
  });

  it("sequences layered and batched events instead of stacking every tone", () => {
    const timeline = gameSoundTimeline(["promotion_q", "queen_capture", "check", "victory"]);

    expect(timeline.map((entry) => entry.sound)).toEqual([
      "promotion_q",
      "queen_capture",
      "check",
      "victory",
    ]);
    expect(timeline[0].delay).toBe(0);
    for (let index = 1; index < timeline.length; index += 1) {
      expect(timeline[index].delay).toBeGreaterThan(timeline[index - 1].delay);
    }
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

  it("keeps a human special event when a Solo reply arrives in the same snapshot", () => {
    const previous = snapshot({ version: 1, plyCount: 0, moves: [] });
    expect(classifyGameSounds(previous, snapshot({
      version: 3,
      plyCount: 2,
      moves: [
        { ...snapshot().moves[0], ply: 1, san: "O-O" },
        { ...snapshot().moves[0], ply: 2, color: "b", from: "e7", to: "e5", san: "e5" },
      ],
    }))).toEqual(["castle", "move"]);
  });

  it("plays promotion and result sounds for a game-ending promotion", () => {
    const previous = snapshot({ version: 3, plyCount: 0, moves: [] });
    expect(classifyGameSounds(previous, snapshot({
      version: 4,
      plyCount: 1,
      status: "completed",
      outcome: { winner: "w", reason: "checkmate" },
      moves: [{ ...snapshot().moves[0], promotion: "q", san: "e8=Q#" }],
    }))).toEqual(["promotion_q", "check", "victory"]);
  });

  it("plays terminal sounds for claims and resignations that add no move", () => {
    const previous = snapshot({ version: 7, plyCount: 6 });
    expect(classifyGameSound(previous, snapshot({
      version: 8,
      plyCount: 6,
      status: "completed",
      outcome: { winner: null, reason: "threefold_repetition" },
    }))).toBe("draw");
    expect(classifyGameSound(previous, snapshot({
      version: 8,
      plyCount: 6,
      status: "completed",
      outcome: { winner: "b", reason: "resignation" },
    }))).toBe("defeat");
  });
});
