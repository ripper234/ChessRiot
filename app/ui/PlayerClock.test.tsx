import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GameSnapshot } from "@/lib/game-types";
import { formattedElapsedTime, liveElapsedTime, PlayerClock } from "./PlayerClock";

function game(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    id: "clock-game",
    mode: "solo",
    variantId: "standard",
    aiDifficulty: 3,
    status: "active",
    version: 1,
    initialFen: "start",
    fen: "start",
    turn: "w",
    plyCount: 0,
    elapsedMs: { w: 4_000, b: 2_000 },
    turnStartedAt: "2026-08-03T10:00:00.000Z",
    clockAsOf: "2026-08-03T10:00:04.000Z",
    players: { white: { name: "Ron" }, black: { name: "Riot Bot" } },
    you: { color: "w", name: "Ron" },
    check: false,
    claimableDraws: [],
    outcome: null,
    moves: [],
    updatedAt: "2026-08-03T10:00:04.000Z",
    ...overrides,
  };
}

describe("PlayerClock", () => {
  it("adds live time only to the active player", () => {
    const snapshot = game();
    expect(liveElapsedTime(snapshot, "w", 3_000)).toBe(7_000);
    expect(liveElapsedTime(snapshot, "b", 3_000)).toBe(2_000);
  });

  it("uses a monotonic local delta, freezes completed clocks, and formats long games", () => {
    const snapshot = game({ status: "completed", turnStartedAt: null });
    expect(liveElapsedTime(snapshot, "w", 99_000)).toBe(4_000);
    expect(liveElapsedTime(game(), "w", -99_000)).toBe(4_000);
    expect(formattedElapsedTime(3_725_000)).toBe("1:02:05");
  });

  it.each([1, 3, 5] as const)("renders no live clock for a %d-day game", (turnPaceDays) => {
    expect(renderToStaticMarkup(
      <PlayerClock game={game({ mode: "multiplayer", turnPaceDays })} color="w" />,
    )).toBe("");
  });

  it("keeps the informational clock for games without a day pace", () => {
    const html = renderToStaticMarkup(
      <PlayerClock game={game({ turnPaceDays: null })} color="w" />,
    );
    expect(html).toContain("player-clock");
    expect(html).toContain('dir="ltr"');
    expect(html).toContain("White elapsed time");
  });
});
