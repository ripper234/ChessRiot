import { Chess } from "chess.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseComputerMove } from "./computer-player";
import { applyCandidate, legalMagicMoves } from "./game-rules";
import type { AiDifficulty } from "./game-types";
import type { CompiledMagicRules } from "./magic-rules";

describe("Riot Bot", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([1, 2, 3, 4, 5] as AiDifficulty[])(
    "returns a legal move at difficulty %i",
    (difficulty) => {
      const chess = new Chess();
      chess.move("e4");
      const move = chooseComputerMove(chess.fen(), difficulty, "b", () => 0);

      expect(move).not.toBeNull();
      expect(() => chess.move(move!)).not.toThrow();
    },
  );

  it("takes an immediate checkmate on the highest difficulty", () => {
    const chess = new Chess();
    chess.move("f3");
    chess.move("e5");
    chess.move("g4");

    const move = chooseComputerMove(chess.fen(), 5, "b", () => 0);
    expect(move).toMatchObject({ from: "d8", to: "h4" });
    chess.move(move!);
    expect(chess.isCheckmate()).toBe(true);
  });

  it("takes an immediate checkmate as White", () => {
    const chess = new Chess("6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1");
    const move = chooseComputerMove(chess.fen(), 5, "w", () => 0);
    expect(move).toMatchObject({ from: "d1", to: "d8" });
    chess.move(move!);
    expect(chess.isCheckmate()).toBe(true);
  });

  it("keeps the strongest search bounded when the edge runtime clock is frozen", () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const chess = new Chess();
    chess.move("e4");

    const startedAt = process.hrtime.bigint();
    const move = chooseComputerMove(chess.fen(), 5, "b", () => 0);
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    expect(move).not.toBeNull();
    expect(() => chess.move(move!)).not.toThrow();
    expect(elapsedMs).toBeLessThan(2_500);
  }, 3_000);

  it("returns null when the position has no legal moves", () => {
    expect(chooseComputerMove("7k/5Q2/7K/8/8/8/8/8 b - - 0 1", 3)).toBeNull();
  });

  it("preserves promotion details", () => {
    const move = chooseComputerMove("7K/8/8/8/8/8/p7/7k b - - 0 1", 4, "b", () => 0);
    expect(move).toMatchObject({ from: "a2", to: "a1", promotion: "q" });
  });

  it("never selects a forbidden promotion", () => {
    const rules: CompiledMagicRules = {
      version: 1,
      rules: [{ kind: "no_promotion" }],
    };
    const move = chooseComputerMove(
      "7K/8/8/8/8/8/p7/7k b - - 0 1",
      4,
      "b",
      () => 0,
      rules,
    );
    expect(move).not.toMatchObject({ from: "a2", to: "a1" });
    expect(move?.promotion).toBeUndefined();
  });

  it("returns a complete legal rook action when the double-move rule is active", () => {
    const rules: CompiledMagicRules = {
      version: 1,
      rules: [{ kind: "double_move", piece: "r" }],
    };
    const fen = "4k3/8/8/8/8/8/R7/4K3 w - - 0 1";
    const move = chooseComputerMove(fen, 3, "w", () => 0, rules);
    expect(move).not.toBeNull();
    if (move?.from === "a2" && move.second) {
      expect(move.second.from).toBe(move.to);
    } else if (move?.from === "a2") {
      const afterFirst = new Chess(fen);
      afterFirst.move(move);
      expect(afterFirst.isCheck()).toBe(true);
    }
    expect(() => applyCandidate(fen, [], move!, rules)).not.toThrow();
  });

  it("returns a complete legal knight action when the double-move rule is active", () => {
    const rules: CompiledMagicRules = {
      version: 2,
      rules: [{ kind: "double_move", piece: "n" }],
    };
    const fen = "4k3/8/8/8/8/8/1N6/4K3 w - - 0 1";
    const moves = legalMagicMoves(new Chess(fen), rules);
    const knightIndex = moves.findIndex((move) => move.from === "b2");
    let randomCall = 0;
    const move = chooseComputerMove(
      fen,
      1,
      "w",
      () => randomCall++ === 0 ? (knightIndex + 0.1) / moves.length : 0,
      rules,
    );
    expect(move).toMatchObject({ from: "b2" });
    expect(move?.second?.from).toBe(move?.to);
    expect(() => applyCandidate(fen, [], move!, rules)).not.toThrow();
  });
});
