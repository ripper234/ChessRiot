import { describe, expect, it } from "vitest";
import { magicDraftTapDecision } from "./magic-turn-ui";

describe("Magic double-move interaction", () => {
  it("moves when a staged rook or knight activates a legal second destination", () => {
    expect(
      magicDraftTapDecision("a3", "a3", "h3", ["a4", "h3"]),
    ).toBe("move");
    expect(
      magicDraftTapDecision("f3", "f3", "e5", ["d4", "e5"]),
    ).toBe("move");
  });

  it("keeps the staged magic piece selected when it is activated again", () => {
    expect(
      magicDraftTapDecision("a3", "a3", "a3", ["a4", "h3"]),
    ).toBe("select_piece");
  });

  it("rejects switching pieces or tapping an illegal destination", () => {
    expect(
      magicDraftTapDecision("a3", "a3", "b2", ["a4", "h3"]),
    ).toBe("reject");
  });
});
