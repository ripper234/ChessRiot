import { describe, expect, it } from "vitest";
import {
  MAGIC_PROMPT_MAX_LENGTH,
  magicMoveLimit,
  magicRuleLabel,
  normalizeMagicPrompt,
  parseStoredMagicRules,
  serializeMagicRules,
  validateCompiledMagicRules,
} from "./magic-rules";

describe("Magic Rules documents", () => {
  it("normalizes bounded user prompts without interpreting their wording", () => {
    expect(normalizeMagicPrompt("  פרשים　זזים 3 פעמים  ")).toEqual({
      ok: true,
      prompt: "פרשים זזים 3 פעמים",
    });
    expect(normalizeMagicPrompt("")).toMatchObject({ ok: false });
    expect(normalizeMagicPrompt("x".repeat(MAGIC_PROMPT_MAX_LENGTH + 1)))
      .toMatchObject({ ok: false });
    expect(normalizeMagicPrompt("Knights move\u0000")).toMatchObject({ ok: false });
  });

  it("validates a generic v3 move sequence and deterministic filters", () => {
    const compiled = validateCompiledMagicRules({
      version: 3,
      rules: [
        { kind: "move_sequence", pieces: ["n", "b"], maxMoves: 3 },
        { kind: "forbid_action", action: "promotion" },
      ],
    });
    expect(magicMoveLimit(compiled, "n")).toBe(3);
    expect(magicMoveLimit(compiled, "b")).toBe(3);
    expect(magicMoveLimit(compiled, "r")).toBe(1);
    expect(compiled.rules.map(magicRuleLabel)).toEqual([
      "Knights, Bishops may move up to 3 times per turn; check ends the turn",
      "Pawns cannot move onto the final rank",
    ]);
  });

  it("round-trips v3 storage and keeps v1 and v2 games readable", () => {
    const compiled = validateCompiledMagicRules({
      version: 3,
      rules: [{ kind: "move_sequence", pieces: ["n"], maxMoves: 4 }],
    });
    expect(parseStoredMagicRules(serializeMagicRules(compiled))).toEqual(compiled);
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

  it("fails closed on invalid versions, counts, duplicates, and overlapping piece rules", () => {
    expect(() => validateCompiledMagicRules({
      version: 3,
      rules: [{ kind: "move_sequence", pieces: ["n"], maxMoves: 7 }],
    })).toThrow("Compiled magic rules are invalid");
    expect(() => validateCompiledMagicRules({
      version: 3,
      rules: [
        { kind: "move_sequence", pieces: ["n"], maxMoves: 2 },
        { kind: "move_sequence", pieces: ["n"], maxMoves: 3 },
      ],
    })).toThrow("Compiled magic rules are invalid");
    expect(() => parseStoredMagicRules(
      '{"version":1,"rules":[{"kind":"double_move","piece":"n"}]}',
    )).toThrow("Stored magic rules are invalid");
    expect(() => parseStoredMagicRules(
      '{"version":4,"rules":[{"kind":"forbid_action","action":"castling"}]}',
    )).toThrow("Stored magic rules are invalid");
  });
});
