import { describe, expect, it } from "vitest";
import { isStoredOpponentUsername } from "./CreateGame";

describe("Magic game recovery opponent usernames", () => {
  it("accepts complete international handles instead of counting UTF-16 units", () => {
    expect(isStoredOpponentUsername("א\u05B0".repeat(20))).toBe(true);
    expect(isStoredOpponentUsername("𐐀𐐁𐐂")).toBe(true);
    expect(isStoredOpponentUsername("棋手88")).toBe(true);
  });

  it("accepts the empty solo-game value and rejects malformed stored handles", () => {
    expect(isStoredOpponentUsername("")).toBe(true);
    expect(isStoredOpponentUsername("knight 81")).toBe(false);
    expect(isStoredOpponentUsername("פרש\u202E81")).toBe(false);
  });
});
