import { describe, expect, it } from "vitest";
import { canPlayPendingOpening } from "./pending-opening";
import { moveIntentStillValid } from "./move-confirmation";

describe("opening before acceptance", () => {
  const pending = { mode: "multiplayer", status: "waiting", turn: "w", plyCount: 0, turnPaceDays: 3 } as const;
  it("allows only White's first turn in a day-paced waiting game", () => {
    for (const turnPaceDays of [1, 3, 5] as const) expect(canPlayPendingOpening({ ...pending, turnPaceDays }, "w")).toBe(true);
    expect(canPlayPendingOpening(pending, "b")).toBe(false);
    for (const override of [{ mode: "solo" }, { status: "active" }, { status: "completed" },
      { turn: "b" }, { plyCount: 1 }, { turnPaceDays: null }, { turnPaceDays: undefined }] as const) {
      expect(canPlayPendingOpening({ ...pending, ...override }, "w")).toBe(false);
    }
    expect(canPlayPendingOpening({}, "w")).toBe(false);
  });
  it("keeps optional move confirmation valid until acceptance or another version changes the position", () => {
    const intent = { from: "e2", to: "e4", piece: "p", expectedVersion: 0 } as const;
    const game = { ...pending, version: 0, you: { color: "w", name: "Creator" } } as const;
    expect(moveIntentStillValid(intent, game)).toBe(true);
    expect(moveIntentStillValid(intent, { ...game, version: 1 })).toBe(false);
    expect(moveIntentStillValid(intent, { ...game, plyCount: 1, turn: "b" })).toBe(false);
    expect(moveIntentStillValid(intent, { ...game, you: { color: "b", name: "Friend" } })).toBe(false);
  });
});
