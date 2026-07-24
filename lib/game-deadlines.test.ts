import { describe, expect, it } from "vitest";
import {
  formatTurnTimeLeft,
  turnWindowMs,
  turnDeadlineAt,
  turnDeadlineExpired,
} from "./game-deadlines";

describe("multiplayer turn deadlines", () => {
  it("sets a deadline exactly three days after the last game mutation", () => {
    expect(turnDeadlineAt("2026-07-24T12:00:00.000Z", 3))
      .toBe("2026-07-27T12:00:00.000Z");
    expect(turnWindowMs(3)).toBe(259_200_000);
  });

  it("expires at the deadline, not before it", () => {
    const updatedAt = "2026-07-24T12:00:00.000Z";
    expect(turnDeadlineExpired(
      updatedAt,
      3,
      Date.parse("2026-07-27T11:59:59.999Z"),
    )).toBe(false);
    expect(turnDeadlineExpired(
      updatedAt,
      3,
      Date.parse("2026-07-27T12:00:00.000Z"),
    )).toBe(true);
  });

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
  });
});
