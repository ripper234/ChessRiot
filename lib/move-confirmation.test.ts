import { describe, expect, it } from "vitest";
import {
  describeMoveIntent,
  MOVE_CONFIRMATION_PREFERENCE_KEY,
  moveIntentStillValid,
  readMoveConfirmationPreference,
  type MoveIntent,
  writeMoveConfirmationPreference,
} from "./move-confirmation";

function memoryStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

const MOVE: MoveIntent = {
  from: "e2",
  to: "e4",
  expectedVersion: 7,
  piece: "p",
};

describe("move confirmation preference", () => {
  it("is opt-in and accepts only the exact enabled value", () => {
    expect(readMoveConfirmationPreference(memoryStorage())).toBe(false);
    expect(readMoveConfirmationPreference(memoryStorage({
      [MOVE_CONFIRMATION_PREFERENCE_KEY]: "true",
    }))).toBe(false);
    expect(readMoveConfirmationPreference(memoryStorage({
      [MOVE_CONFIRMATION_PREFERENCE_KEY]: "on",
    }))).toBe(true);
  });

  it("round-trips on and off and fails safely when storage is blocked", () => {
    const storage = memoryStorage();
    writeMoveConfirmationPreference(true, storage);
    expect(readMoveConfirmationPreference(storage)).toBe(true);
    writeMoveConfirmationPreference(false, storage);
    expect(readMoveConfirmationPreference(storage)).toBe(false);

    const blocked = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    expect(readMoveConfirmationPreference(blocked)).toBe(false);
    expect(() => writeMoveConfirmationPreference(true, blocked)).not.toThrow();
  });
});

describe("move confirmation intent", () => {
  it("describes standard, promotion, and atomic Magic moves", () => {
    expect(describeMoveIntent(MOVE)).toBe("Move pawn e2 → e4?");
    expect(describeMoveIntent({
      ...MOVE,
      from: "e7",
      to: "e8",
      promotion: "q",
    })).toBe("Move pawn e7 → e8 and promote to queen?");
    expect(describeMoveIntent({
      ...MOVE,
      from: "g1",
      to: "f3",
      second: { from: "f3", to: "e5" },
      piece: "n",
    })).toBe("Move knight g1 → f3 → e5?");
  });

  it("rejects a confirmation after the authoritative position changes", () => {
    const game = {
      version: 7,
      status: "active" as const,
      turn: "w" as const,
      you: { color: "w" as const, name: "Player" },
    };
    expect(moveIntentStillValid(MOVE, game)).toBe(true);
    expect(moveIntentStillValid(MOVE, { ...game, version: 8 })).toBe(false);
    expect(moveIntentStillValid(MOVE, { ...game, turn: "b" })).toBe(false);
    expect(moveIntentStillValid(MOVE, { ...game, status: "completed" })).toBe(false);
  });
});
