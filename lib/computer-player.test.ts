import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { chooseComputerMove } from "./computer-player";
import type { AiDifficulty } from "./game-types";

describe("Riot Bot", () => {
  it.each([1, 2, 3, 4, 5] as AiDifficulty[])(
    "returns a legal move at difficulty %i",
    (difficulty) => {
      const chess = new Chess();
      chess.move("e4");
      const move = chooseComputerMove(chess.fen(), difficulty, () => 0);

      expect(move).not.toBeNull();
      expect(() => chess.move(move!)).not.toThrow();
    },
  );

  it("takes an immediate checkmate on the highest difficulty", () => {
    const chess = new Chess();
    chess.move("f3");
    chess.move("e5");
    chess.move("g4");

    const move = chooseComputerMove(chess.fen(), 5, () => 0);
    expect(move).toMatchObject({ from: "d8", to: "h4" });
    chess.move(move!);
    expect(chess.isCheckmate()).toBe(true);
  });

  it("returns null when the position has no legal moves", () => {
    expect(chooseComputerMove("7k/5Q2/7K/8/8/8/8/8 b - - 0 1", 3)).toBeNull();
  });

  it("preserves promotion details", () => {
    const move = chooseComputerMove("7K/8/8/8/8/8/p7/7k b - - 0 1", 4, () => 0);
    expect(move).toMatchObject({ from: "a2", to: "a1", promotion: "q" });
  });
});
