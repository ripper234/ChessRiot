import { describe, expect, it } from "vitest";
import {
  canonicalMagicWorldRules,
  displayMagicWorldCode,
  isMagicWorldCode,
  magicWorldIdentity,
} from "./magic-world-code";

describe("Magic World content identity", () => {
  it("deduplicates legacy versions, rule order, and equivalent grouping", async () => {
    const legacy = await magicWorldIdentity({
      version: 2,
      rules: [
        { kind: "no_promotion" },
        { kind: "double_move", piece: "r" },
        { kind: "double_move", piece: "n" },
      ],
    });
    const current = await magicWorldIdentity({
      version: 3,
      rules: [
        { kind: "move_sequence", pieces: ["n", "r"], maxMoves: 2 },
        { kind: "forbid_action", action: "promotion" },
      ],
    });
    expect(current).toEqual(legacy);
    expect(current.code).toMatch(/^0x[0-9a-f]{40}$/);
    expect(current.fullHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("sorts groups and actions into one deterministic document", () => {
    expect(canonicalMagicWorldRules({
      version: 3,
      rules: [
        { kind: "forbid_action", action: "en_passant" },
        { kind: "move_sequence", pieces: ["q"], maxMoves: 3 },
        { kind: "move_sequence", pieces: ["r", "p"], maxMoves: 2 },
        { kind: "forbid_action", action: "castling" },
      ],
    }).rules).toEqual([
      { kind: "move_sequence", pieces: ["p", "r"], maxMoves: 2 },
      { kind: "move_sequence", pieces: ["q"], maxMoves: 3 },
      { kind: "forbid_action", action: "castling" },
      { kind: "forbid_action", action: "en_passant" },
    ]);
  });

  it("changes identity when executable semantics change", async () => {
    const twice = await magicWorldIdentity({
      version: 3,
      rules: [{ kind: "move_sequence", pieces: ["n"], maxMoves: 2 }],
    });
    const thrice = await magicWorldIdentity({
      version: 3,
      rules: [{ kind: "move_sequence", pieces: ["n"], maxMoves: 3 }],
    });
    expect(twice.code).not.toBe(thrice.code);
  });

  it("uses a wallet-style compact display without weakening stored identity", async () => {
    const world = await magicWorldIdentity({
      version: 3,
      rules: [{ kind: "forbid_action", action: "castling" }],
    });
    expect(isMagicWorldCode(world.code)).toBe(true);
    expect(displayMagicWorldCode(world.code)).toMatch(/^0x[0-9A-F]{6}…[0-9A-F]{4}$/);
    expect(isMagicWorldCode(displayMagicWorldCode(world.code))).toBe(false);
  });
});
