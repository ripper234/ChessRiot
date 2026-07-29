import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { chooseComputerMove } from "./computer-player";
import { applyCandidate } from "./game-rules";
import {
  GAME_VARIANTS,
  gameVariant,
  isGameVariantId,
  normalizeGameVariantId,
} from "./game-variants";

describe("game variants", () => {
  it("keeps every server-owned setup legal and playable", () => {
    for (const variant of GAME_VARIANTS) {
      const chess = new Chess(variant.initialFen);
      const pieces = chess.board().flat().filter((piece) => piece !== null);
      const whiteMaterial = pieces
        .filter((piece) => piece.color === "w")
        .map((piece) => piece.type)
        .sort();
      const blackMaterial = pieces
        .filter((piece) => piece.color === "b")
        .map((piece) => piece.type)
        .sort();
      expect(chess.turn(), variant.id).toBe("w");
      expect(chess.moves().length, variant.id).toBeGreaterThan(0);
      expect(chess.isGameOver(), variant.id).toBe(false);
      expect(chess.isCheck(), variant.id).toBe(false);
      expect(whiteMaterial.filter((piece) => piece === "k"), variant.id).toHaveLength(1);
      expect(blackMaterial.filter((piece) => piece === "k"), variant.id).toHaveLength(1);
      expect(whiteMaterial, variant.id).toEqual(blackMaterial);
      expect(variant.initialFen.split(" ")[2], variant.id)
        .toBe(variant.id === "standard" ? "KQkq" : "-");
    }
  });

  it("gives Riot Bot a legal opening in every setup", () => {
    for (const variant of GAME_VARIANTS) {
      const candidate = chooseComputerMove(
        variant.initialFen,
        3,
        "w",
        () => 0,
      );
      expect(candidate, variant.id).not.toBeNull();
      expect(() => applyCandidate(
        variant.initialFen,
        [],
        candidate!,
      ), variant.id).not.toThrow();
    }
  });

  it("ships one classic setup and three mini games", () => {
    expect(GAME_VARIANTS.filter((variant) => !variant.miniGame)).toHaveLength(1);
    expect(GAME_VARIANTS.filter((variant) => variant.miniGame)).toHaveLength(3);
  });

  it("never trusts unknown variant ids", () => {
    expect(isGameVariantId("half-army")).toBe(true);
    expect(isGameVariantId("only-pawns")).toBe(false);
    expect(normalizeGameVariantId("only-pawns")).toBe("standard");
    expect(gameVariant("only-pawns").id).toBe("standard");
  });
});
