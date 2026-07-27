import { describe, expect, it } from "vitest";
import {
  MAGIC_PROMPT_MAX_LENGTH,
  magicMoveLimit,
  magicRuleLabel,
  normalizeMagicPrompt,
  parseStoredMagicRules,
  serializeMagicRules,
  validateCompiledMagicRules,
  type CompiledMagicRules,
} from "./magic-rules";

const TRIPLE_KNIGHT: CompiledMagicRules = {
  version: 3,
  rules: [{
    kind: "move_sequence",
    pieces: ["n"],
    maxMoves: 3,
  }],
};

describe("Magic Rules documents", () => {
  it("normalizes Unicode and whitespace without changing the player's language", () => {
    expect(normalizeMagicPrompt("  פרשים　זזים   3 פעמים  ")).toEqual({
      ok: true,
      prompt: "פרשים זזים 3 פעמים",
    });
  });

  it("rejects empty, overlong, and control-character prompts", () => {
    expect(normalizeMagicPrompt("")).toMatchObject({ ok: false });
    expect(normalizeMagicPrompt("x".repeat(MAGIC_PROMPT_MAX_LENGTH + 1)))
      .toMatchObject({ ok: false });
    expect(normalizeMagicPrompt("Knights move twice\u0000"))
      .toMatchObject({ ok: false });
  });

  it("validates canonical v3 move counts and produces stable labels", () => {
    expect(validateCompiledMagicRules(TRIPLE_KNIGHT)).toEqual(TRIPLE_KNIGHT);
    expect(magicMoveLimit(TRIPLE_KNIGHT, "n")).toBe(3);
    expect(magicMoveLimit(TRIPLE_KNIGHT, "r")).toBe(1);
    expect(magicRuleLabel(TRIPLE_KNIGHT.rules[0]))
      .toBe("Knights may move up to 3 times per turn; check ends the turn");
  });

  it("round-trips v3 storage and keeps strict v1/v2 games readable", () => {
    expect(parseStoredMagicRules(serializeMagicRules(TRIPLE_KNIGHT)))
      .toEqual(TRIPLE_KNIGHT);
    expect(parseStoredMagicRules(
      '{"version":1,"rules":[{"kind":"double_move","piece":"r"}]}',
    )).toEqual({
      version: 1,
      rules: [{ kind: "double_move", piece: "r" }],
    });
    expect(parseStoredMagicRules(
      '{"version":2,"rules":[{"kind":"double_move","piece":"n"}]}',
    )).toEqual({
      version: 2,
      rules: [{ kind: "double_move", piece: "n" }],
    });
  });

  it("fails closed on unknown versions, fields, duplicates, and counts above the cap", () => {
    for (const value of [
      '{"version":1,"rules":[{"kind":"double_move","piece":"n"}]}',
      '{"version":4,"rules":[{"kind":"move_sequence","pieces":["n"],"maxMoves":3}]}',
      '{"version":3,"rules":[{"kind":"move_sequence","pieces":["n"],"maxMoves":7}]}',
      '{"version":3,"rules":[{"kind":"move_sequence","pieces":["n"],"maxMoves":3,"extra":true}]}',
      '{"version":3,"rules":[{"kind":"move_sequence","pieces":["n"],"maxMoves":3}],"extra":true}',
      '{"version":3,"rules":[{"kind":"move_sequence","pieces":["n"],"maxMoves":3},{"kind":"move_sequence","pieces":["n"],"maxMoves":3}]}',
    ]) {
      expect(() => parseStoredMagicRules(value))
        .toThrow("Stored magic rules are invalid");
    }
  });

  it("canonicalizes piece order without retaining caller-owned arrays", () => {
    const pieces = ["q", "p"] as const;
    const compiled = validateCompiledMagicRules({
      version: 3,
      rules: [{ kind: "move_sequence", pieces: [...pieces], maxMoves: 2 }],
    });
    expect(compiled).toEqual({
      version: 3,
      rules: [{ kind: "move_sequence", pieces: ["p", "q"], maxMoves: 2 }],
    });
  });
});
