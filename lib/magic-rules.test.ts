import { describe, expect, it } from "vitest";
import {
  compileMagicPrompt,
  MAGIC_PROMPT_MAX_LENGTH,
  parseStoredMagicRules,
  serializeMagicRules,
} from "./magic-rules";

describe("Magic Rules compiler", () => {
  it("compiles the two product examples into immutable canonical rules", () => {
    const result = compileMagicPrompt(
      "Rooks move twice. Pawns never get promoted.",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled).toEqual({
      version: 1,
      rules: [
        { kind: "double_move", piece: "r" },
        { kind: "no_promotion" },
      ],
    });
    expect(result.labels).toEqual([
      "Rooks may move twice; check ends the turn",
      "Pawns cannot move onto the final rank",
    ]);
  });

  it("normalizes aliases, Unicode, whitespace, and duplicate rules", () => {
    const result = compileMagicPrompt(
      "  Please　make it so that rooks can move twice AND rooks have two moves.  ",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled.rules).toEqual([
      { kind: "double_move", piece: "r" },
    ]);
  });

  it("supports safe move filters without silently accepting unknown clauses", () => {
    const supported = compileMagicPrompt("No castling; no en passant");
    expect(supported.ok).toBe(true);
    const mixed = compileMagicPrompt("No castling and queens explode");
    expect(mixed).toMatchObject({
      ok: false,
      unsupported: ["queens explode"],
    });
  });

  it("rejects empty, overlong, control-character, and prompt-injection text", () => {
    expect(compileMagicPrompt("")).toMatchObject({ ok: false });
    expect(compileMagicPrompt("x".repeat(MAGIC_PROMPT_MAX_LENGTH + 1)))
      .toMatchObject({ ok: false });
    expect(compileMagicPrompt("Rooks move twice\u0000"))
      .toMatchObject({ ok: false });
    expect(compileMagicPrompt("<script>Rooks move twice</script>"))
      .toMatchObject({ ok: false });
  });

  it("round-trips canonical storage and fails closed on unknown versions", () => {
    const result = compileMagicPrompt("Pawns never promote");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = serializeMagicRules(result.compiled);
    expect(parseStoredMagicRules(serialized)).toEqual(result.compiled);
    expect(() => parseStoredMagicRules('{"version":2,"rules":[{"kind":"no_promotion"}]}'))
      .toThrow("Stored magic rules are invalid");
  });
});
