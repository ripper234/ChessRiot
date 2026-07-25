import { describe, expect, it } from "vitest";
import type { GameSnapshot, PublicMove } from "./game-types";
import {
  gameIdFromPathname,
  hasUnseenRelease,
  newestOpponentMoveAfter,
  opponentMovedSince,
  parseEnabledPreference,
  releaseTarget,
  shouldNotifyForOpponentMove,
  type WatchedAccountGame,
} from "./pwa";

function move(ply: number, color: "w" | "b"): PublicMove {
  return {
    ply,
    color,
    from: color === "w" ? "e2" : "e7",
    to: color === "w" ? "e4" : "e5",
    promotion: null,
    san: color === "w" ? "e4" : "e5",
    createdAt: "2026-07-24T00:00:00.000Z",
  };
}

const game = {
  you: { color: "w", name: "Player" },
  moves: [move(1, "w"), move(2, "b"), move(3, "w"), move(4, "b")],
} satisfies Pick<GameSnapshot, "moves" | "you">;

describe("PWA release state", () => {
  it("uses a remotely available version as the release target", () => {
    expect(releaseTarget("0.4.0", null)).toBe("0.4.0");
    expect(releaseTarget("0.4.0", "0.4.1")).toBe("0.4.1");
  });

  it("shows no dot on a first visit and a dot only for an unseen target", () => {
    expect(hasUnseenRelease("0.4.0", null, null)).toBe(false);
    expect(hasUnseenRelease("0.4.0", "0.4.0", null)).toBe(false);
    expect(hasUnseenRelease("0.4.0", "0.3.5", null)).toBe(true);
    expect(hasUnseenRelease("0.4.0", "0.4.0", "0.4.1")).toBe(true);
    expect(hasUnseenRelease("0.4.0", "0.4.1", "0.4.1")).toBe(false);
  });

  it("keeps notifications opt-in", () => {
    expect(parseEnabledPreference(null)).toBe(false);
    expect(parseEnabledPreference("false")).toBe(false);
    expect(parseEnabledPreference("true")).toBe(true);
  });
});

describe("opponent move notification state", () => {
  it("recognizes only game routes", () => {
    expect(gameIdFromPathname("/g/game-123")).toBe("game-123");
    expect(gameIdFromPathname("/g/game%20123/")).toBe("game 123");
    expect(gameIdFromPathname("/join/token")).toBeNull();
    expect(gameIdFromPathname("/g/%")).toBeNull();
  });

  it("finds the newest opponent move after the local baseline", () => {
    expect(newestOpponentMoveAfter(game, 1)?.ply).toBe(4);
    expect(newestOpponentMoveAfter(game, 2)?.ply).toBe(4);
    expect(newestOpponentMoveAfter(game, 4)).toBeNull();
  });

  it("notifies only after a baseline and only while the page is unfocused", () => {
    expect(shouldNotifyForOpponentMove(game, null, false)).toBe(false);
    expect(shouldNotifyForOpponentMove(game, 1, true)).toBe(false);
    expect(shouldNotifyForOpponentMove(game, 1, false)).toBe(true);
    expect(shouldNotifyForOpponentMove(game, 4, false)).toBe(false);
  });

  it("detects an opponent move from account-wide game summaries", () => {
    const baseline: WatchedAccountGame = {
      id: "game-1",
      mode: "multiplayer",
      status: "active",
      color: "b",
      opponent: "Ron",
      turn: "w",
      plyCount: 0,
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
    expect(opponentMovedSince(undefined, baseline)).toBe(false);
    expect(opponentMovedSince(baseline, {
      ...baseline,
      turn: "b",
      plyCount: 1,
      updatedAt: "2026-07-24T00:01:00.000Z",
    })).toBe(true);
    expect(opponentMovedSince(baseline, {
      ...baseline,
      color: "w",
      turn: "b",
      plyCount: 1,
      updatedAt: "2026-07-24T00:01:00.000Z",
    })).toBe(false);
  });

  it("does not treat solo bot moves as asynchronous opponent alerts", () => {
    const baseline: WatchedAccountGame = {
      id: "solo-1",
      mode: "solo",
      status: "active",
      color: "b",
      opponent: "Riot Bot",
      turn: "w",
      plyCount: 0,
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
    expect(opponentMovedSince(baseline, {
      ...baseline,
      turn: "b",
      plyCount: 1,
      updatedAt: "2026-07-24T00:01:00.000Z",
    })).toBe(false);
  });
});
