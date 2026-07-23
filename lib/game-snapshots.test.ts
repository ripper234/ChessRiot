import { describe, expect, it } from "vitest";
import { shouldAcceptGameSnapshot } from "./game-snapshots";

describe("shouldAcceptGameSnapshot", () => {
  it("accepts the first and newer snapshots", () => {
    expect(shouldAcceptGameSnapshot(-1, 0)).toBe(true);
    expect(shouldAcceptGameSnapshot(2, 3)).toBe(true);
  });

  it("rejects duplicate and out-of-order snapshots", () => {
    expect(shouldAcceptGameSnapshot(3, 3)).toBe(false);
    expect(shouldAcceptGameSnapshot(3, 2)).toBe(false);
  });
});
