import { describe, expect, it } from "vitest";
import {
  formatTurnTimeLeft,
  turnWindowMs,
  turnDeadlineAt,
  turnDeadlineExpired,
} from "./game-deadlines";

describe("multiplayer turn deadlines", () => {
  it.each([
    [1, "2026-07-25T12:00:00.000Z", 86_400_000],
    [3, "2026-07-27T12:00:00.000Z", 259_200_000],
    [5, "2026-07-29T12:00:00.000Z", 432_000_000],
  ] as const)(
    "sets and enforces the %i-day deadline at the exact millisecond",
    (pace, deadline, windowMs) => {
    const updatedAt = "2026-07-24T12:00:00.000Z";
    expect(turnDeadlineAt(updatedAt, pace)).toBe(deadline);
    expect(turnWindowMs(pace)).toBe(windowMs);
    expect(turnDeadlineExpired(
      updatedAt,
      pace,
      Date.parse(deadline) - 1,
    )).toBe(false);
    expect(turnDeadlineExpired(
      updatedAt,
      pace,
      Date.parse(deadline),
    )).toBe(true);
    },
  );

  it("does not expire malformed legacy timestamps", () => {
    expect(turnDeadlineAt("not-a-date", 3)).toBeNull();
    expect(turnDeadlineExpired("not-a-date", 3)).toBe(false);
  });

  it("formats a compact countdown for the game UI", () => {
    const now = Date.parse("2026-07-24T12:00:00.000Z");
    expect(formatTurnTimeLeft("2026-07-27T12:00:00.000Z", now)).toBe("3D LEFT");
    expect(formatTurnTimeLeft("2026-07-25T13:00:00.000Z", now)).toBe("1D 1H LEFT");
    expect(formatTurnTimeLeft("2026-07-24T12:42:00.000Z", now)).toBe("42M LEFT");
    expect(formatTurnTimeLeft("2026-07-24T11:59:00.000Z", now)).toBe("TIME EXPIRED");
    expect(formatTurnTimeLeft("not-a-deadline", now)).toBe("DEADLINE UNAVAILABLE");
    expect(formatTurnTimeLeft("2026-07-27T12:00:00.000Z", now, "he")).toBe("נותרו 3 ימים");
    expect(formatTurnTimeLeft("2026-07-24T11:59:00.000Z", now, "he")).toBe("הזמן נגמר");
  });
});
