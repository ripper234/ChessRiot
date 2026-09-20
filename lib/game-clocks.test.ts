import { describe, expect, it } from "vitest";
import { gameClockSnapshot, type GameClockSource } from "./game-clocks";

const SECOND = 1_000;
const START = "2026-08-03T10:00:00.000Z";

function source(overrides: Partial<GameClockSource> = {}): GameClockSource {
  return {
    mode: "multiplayer",
    status: "active",
    turn: "w",
    createdAt: "2026-08-03T09:00:00.000Z",
    joinedAt: START,
    finishedAt: null,
    moves: [],
    ...overrides,
  };
}

describe("gameClockSnapshot", () => {
  it("keeps waiting multiplayer clocks stopped at zero", () => {
    expect(gameClockSnapshot(source({
      status: "waiting",
      joinedAt: null,
    }), Date.parse("2026-08-03T12:00:00.000Z"))).toEqual({
      elapsedMs: { w: 0, b: 0 },
      turnStartedAt: null,
      clockAsOf: "2026-08-03T12:00:00.000Z",
    });
  });

  it("starts multiplayer clocks at join and includes the open turn", () => {
    expect(gameClockSnapshot(source({
      moves: [
        { color: "w", createdAt: "2026-08-03T10:00:05.000Z" },
        { color: "b", createdAt: "2026-08-03T10:00:12.000Z" },
      ],
    }), Date.parse("2026-08-03T10:00:20.000Z"))).toEqual({
      elapsedMs: { w: 13 * SECOND, b: 7 * SECOND },
      turnStartedAt: "2026-08-03T10:00:12.000Z",
      clockAsOf: "2026-08-03T10:00:20.000Z",
    });
  });

  it("starts solo clocks at game creation", () => {
    expect(gameClockSnapshot(source({
      mode: "solo",
      createdAt: START,
      joinedAt: "2026-08-03T11:00:00.000Z",
      turn: "b",
      moves: [{ color: "w", createdAt: "2026-08-03T10:00:03.000Z" }],
    }), Date.parse("2026-08-03T10:00:08.000Z"))).toEqual({
      elapsedMs: { w: 3 * SECOND, b: 5 * SECOND },
      turnStartedAt: "2026-08-03T10:00:03.000Z",
      clockAsOf: "2026-08-03T10:00:08.000Z",
    });
  });

  it("freezes completed clocks at the recorded finish time", () => {
    const completed = source({
      status: "completed",
      finishedAt: "2026-08-03T10:00:20.000Z",
      moves: [
        { color: "w", createdAt: "2026-08-03T10:00:05.000Z" },
        { color: "b", createdAt: "2026-08-03T10:00:12.000Z" },
      ],
    });

    const first = gameClockSnapshot(
      completed,
      Date.parse("2026-08-03T10:00:30.000Z"),
    );
    const later = gameClockSnapshot(
      completed,
      Date.parse("2026-08-04T10:00:30.000Z"),
    );

    expect(first).toEqual({
      elapsedMs: { w: 13 * SECOND, b: 7 * SECOND },
      turnStartedAt: null,
      clockAsOf: "2026-08-03T10:00:20.000Z",
    });
    expect(later).toEqual(first);
  });

  it("keeps a completed unjoined game at a stable zero", () => {
    const completedBeforeJoin = source({
      status: "completed",
      joinedAt: null,
      finishedAt: "2026-08-03T09:30:00.000Z",
    });

    const first = gameClockSnapshot(
      completedBeforeJoin,
      Date.parse("2026-08-03T10:00:00.000Z"),
    );
    const later = gameClockSnapshot(
      completedBeforeJoin,
      Date.parse("2026-08-04T10:00:00.000Z"),
    );

    expect(first).toEqual({
      elapsedMs: { w: 0, b: 0 },
      turnStartedAt: null,
      clockAsOf: "2026-08-03T09:30:00.000Z",
    });
    expect(later).toEqual(first);
  });

  it("clamps invalid or out-of-order move times instead of subtracting time", () => {
    expect(gameClockSnapshot(source({
      turn: "b",
      moves: [
        { color: "w", createdAt: "2026-08-03T10:00:05.000Z" },
        { color: "b", createdAt: "not-a-date" },
        { color: "w", createdAt: "2026-08-03T10:00:03.000Z" },
      ],
    }), Date.parse("2026-08-03T10:00:10.000Z"))).toEqual({
      elapsedMs: { w: 5 * SECOND, b: 5 * SECOND },
      turnStartedAt: "2026-08-03T10:00:05.000Z",
      clockAsOf: "2026-08-03T10:00:10.000Z",
    });
  });
});
