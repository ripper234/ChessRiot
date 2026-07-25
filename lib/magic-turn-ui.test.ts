import { describe, expect, it } from "vitest";
import { rookDraftTapDecision } from "./magic-turn-ui";

describe("Magic rook tap interaction", () => {
  it("moves when the staged rook taps a legal second destination", () => {
    expect(
      rookDraftTapDecision("a3", "a3", "h3", ["a4", "h3"]),
    ).toBe("move");
  });

  it("keeps the staged rook selected when it is tapped again", () => {
    expect(
      rookDraftTapDecision("a3", "a3", "a3", ["a4", "h3"]),
    ).toBe("select_rook");
  });

  it("rejects switching pieces or tapping an illegal destination", () => {
    expect(
      rookDraftTapDecision("a3", "a3", "b2", ["a4", "h3"]),
    ).toBe("reject");
  });
});
