import { describe, expect, it } from "vitest";
import { parseMoveContinuation } from "./move-continuation";

describe("stored move continuations", () => {
  it("round-trips an arbitrary bounded Magic move sequence", () => {
    expect(parseMoveContinuation(JSON.stringify([
      { from: "f3", to: "e5", san: "Ne5" },
      { from: "e5", to: "c6", san: "Nc6" },
    ]))).toEqual([
      { from: "f3", to: "e5", san: "Ne5" },
      { from: "e5", to: "c6", san: "Nc6" },
    ]);
  });

  it("fails closed on malformed and overlong stored sequences", () => {
    expect(() => parseMoveContinuation("not-json"))
      .toThrow("Stored move continuation is invalid");
    expect(() => parseMoveContinuation(JSON.stringify(
      Array.from({ length: 6 }, () => ({ from: "a1", to: "a2", san: "Ra2" })),
    ))).toThrow("Stored move continuation is invalid");
  });
});
