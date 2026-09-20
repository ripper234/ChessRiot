import { describe, expect, it } from "vitest";
import { friendPairKey } from "./social";

describe("friend pairs", () => {
  it("uses one stable key regardless of request direction", () => {
    expect(friendPairKey("google_z", "google_a")).toBe("google_a:google_z");
    expect(friendPairKey("google_a", "google_z")).toBe("google_a:google_z");
  });
});
