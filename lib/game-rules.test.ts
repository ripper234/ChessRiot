import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import {
  INITIAL_FEN,
  IllegalMoveError,
  analyzeTerminal,
  applyCandidate,
  claimableDraws,
  replayGame,
  replayWithRepetition,
  type CandidateMove,
} from "./game-rules";
import type { Promotion } from "./game-types";
import type { CompiledMagicRules } from "./magic-rules";

const DOUBLE_ROOK: CompiledMagicRules = {
  version: 1,
  rules: [{ kind: "double_move", piece: "r" }],
};
const DOUBLE_KNIGHT: CompiledMagicRules = {
  version: 2,
  rules: [{ kind: "double_move", piece: "n" }],
};
const TRIPLE_KNIGHT: CompiledMagicRules = {
  version: 3,
  rules: [{
    kind: "move_sequence",
    pieces: ["n"],
    maxMoves: 3,
  }],
};
const TRIPLE_PAWN: CompiledMagicRules = {
  version: 3,
  rules: [{
    kind: "move_sequence",
    pieces: ["p"],
    maxMoves: 3,
  }],
};
const NO_PROMOTION: CompiledMagicRules = {
  version: 1,
  rules: [{ kind: "no_promotion" }],
};
const NO_CASTLING: CompiledMagicRules = {
  version: 1,
  rules: [{ kind: "no_castling" }],
};
const NO_EN_PASSANT: CompiledMagicRules = {
  version: 1,
  rules: [{ kind: "no_en_passant" }],
};

type HistoricMove = { from: string; to: string; promotion?: Promotion };

function play(initialFen: string, moves: CandidateMove[]) {
  const history: HistoricMove[] = [];
  let last = null;
  for (const move of moves) {
    last = applyCandidate(initialFen, history.map((item) => ({ ...item, promotion: item.promotion ?? null })), move);
    history.push(move);
  }
  return { history, last, chess: replayGame(initialFen, history.map((item) => ({ ...item, promotion: item.promotion ?? null }))) };
}

describe("ChessRiot rules adapter", () => {
  it("starts with twenty legal moves and rejects an illegal pawn leap", () => {
    expect(replayGame(INITIAL_FEN, []).moves()).toHaveLength(20);
    expect(() => applyCandidate(INITIAL_FEN, [], { from: "e2", to: "e5" })).toThrow(IllegalMoveError);
  });

  it("handles castling through chess.js", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(applyCandidate(fen, [], { from: "e1", to: "g1" }).move.san).toBe("O-O");
    expect(applyCandidate(fen, [], { from: "e1", to: "c1" }).move.san).toBe("O-O-O");
  });

  it("handles en passant and expires it after one reply", () => {
    const immediate = play(INITIAL_FEN, [
      { from: "e2", to: "e4" }, { from: "a7", to: "a6" },
      { from: "e4", to: "e5" }, { from: "d7", to: "d5" },
      { from: "e5", to: "d6" },
    ]);
    expect(immediate.last?.move.isEnPassant()).toBe(true);
    expect(immediate.chess.get("d5")).toBeUndefined();

    const expired = play(INITIAL_FEN, [
      { from: "e2", to: "e4" }, { from: "a7", to: "a6" },
      { from: "e4", to: "e5" }, { from: "d7", to: "d5" },
      { from: "g1", to: "f3" }, { from: "h7", to: "h6" },
    ]);
    expect(() => applyCandidate(INITIAL_FEN, expired.history.map((item) => ({ ...item, promotion: item.promotion ?? null })), { from: "e5", to: "d6" })).toThrow(IllegalMoveError);
  });

  it("rejects en passant when it exposes the king", () => {
    const fen = "k3r3/8/8/3pP3/8/8/8/4K3 w - d6 0 2";
    expect(() => applyCandidate(fen, [], { from: "e5", to: "d6" })).toThrow(IllegalMoveError);
  });

  it.each(["q", "r", "b", "n"] as Promotion[])("promotes a pawn to %s", (promotion) => {
    const result = applyCandidate("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", [], {
      from: "a7", to: "a8", promotion,
    });
    expect(result.move.promotion).toBe(promotion);
    expect(new Chess(result.fenAfter).get("a8")?.type).toBe(promotion);
  });

  it("rejects promotion data on an ordinary move", () => {
    expect(() => applyCandidate(INITIAL_FEN, [], {
      from: "e2",
      to: "e4",
      promotion: "q",
    })).toThrow(IllegalMoveError);
  });

  it("rejects castling through check", () => {
    const fen = "r3k2r/8/8/8/2b5/8/8/R3K2R w KQkq - 0 1";
    expect(() => applyCandidate(fen, [], { from: "e1", to: "g1" }))
      .toThrow(IllegalMoveError);
  });

  it("recognizes checkmate and the winner", () => {
    const result = play(INITIAL_FEN, [
      { from: "f2", to: "f3" }, { from: "e7", to: "e5" },
      { from: "g2", to: "g4" }, { from: "d8", to: "h4" },
    ]).last;
    expect(result?.termination).toBe("checkmate");
    expect(result?.winner).toBe("b");
  });

  it("recognizes check without confusing it with mate", () => {
    const chess = new Chess("4k3/8/8/8/8/8/4R3/4K3 b - - 0 1");
    expect(chess.isCheck()).toBe(true);
    expect(analyzeTerminal(chess).completed).toBe(false);
  });

  it("recognizes stalemate and insufficient material", () => {
    expect(analyzeTerminal(new Chess("4k3/4P3/4K3/8/8/8/8/8 b - - 0 78")).termination).toBe("stalemate");
    expect(analyzeTerminal(new Chess("8/8/8/8/8/8/4k3/6K1 w - - 0 1")).termination).toBe("insufficient_material");
  });

  it("makes threefold repetition claimable instead of ending automatically", () => {
    const played = play(INITIAL_FEN, [
      { from: "g1", to: "f3" }, { from: "g8", to: "f6" },
      { from: "f3", to: "g1" }, { from: "f6", to: "g8" },
      { from: "g1", to: "f3" }, { from: "g8", to: "f6" },
      { from: "f3", to: "g1" }, { from: "f6", to: "g8" },
    ]);
    const replayed = replayWithRepetition(
      INITIAL_FEN,
      played.history.map((item) => ({ ...item, promotion: item.promotion ?? null })),
    );
    expect(played.last?.termination).toBeNull();
    expect(replayed.currentRepetitionCount).toBe(3);
    expect(claimableDraws(replayed.chess, replayed.currentRepetitionCount))
      .toContain("threefold_repetition");
  });

  it("makes the fifty-move rule claimable instead of ending automatically", () => {
    const result = applyCandidate("8/8/8/8/8/8/R6k/K7 w - - 99 50", [], { from: "a2", to: "a3" });
    expect(result.termination).toBeNull();
    expect(claimableDraws(new Chess(result.fenAfter))).toContain("fifty_move");
  });

  it("automatically ends at fivefold repetition", () => {
    const cycle = [
      { from: "g1", to: "f3" }, { from: "g8", to: "f6" },
      { from: "f3", to: "g1" }, { from: "f6", to: "g8" },
    ];
    const result = play(INITIAL_FEN, [...cycle, ...cycle, ...cycle, ...cycle]).last;
    expect(result?.termination).toBe("fivefold_repetition");
  });

  it("automatically ends after seventy-five moves without a pawn move or capture", () => {
    const result = applyCandidate(
      "8/8/8/8/8/8/R6k/K7 w - - 149 75",
      [],
      { from: "a2", to: "a3" },
    );
    expect(result.termination).toBe("seventy_five_move");
  });

  it("commits two moves by the same rook as one atomic ply", () => {
    const result = applyCandidate(
      "4k3/8/8/8/8/8/R7/4K3 w - - 0 1",
      [],
      {
        from: "a2",
        to: "a3",
        second: { from: "a3", to: "h3" },
      },
      DOUBLE_ROOK,
    );
    expect(result.move).toMatchObject({ from: "a2", to: "a3", piece: "r" });
    expect(result.secondMove).toMatchObject({ from: "a3", to: "h3", piece: "r" });
    expect(result.turn).toBe("b");
    expect(new Chess(result.fenAfter).get("h3")).toMatchObject({
      color: "w",
      type: "r",
    });
    expect(result.fenAfter.split(" ")[4]).toBe("1");
    expect(result.fenAfter.split(" ")[5]).toBe("1");
  });

  it("requires the same rook for the second leg and ends a checking first leg", () => {
    const fen = "4k3/8/8/8/8/8/R7/R3K3 w - - 0 1";
    expect(() => applyCandidate(
      fen,
      [],
      {
        from: "a2",
        to: "a3",
        second: { from: "a1", to: "b1" },
      },
      DOUBLE_ROOK,
    )).toThrow(IllegalMoveError);

    const checking = applyCandidate(
      fen,
      [],
      { from: "a2", to: "e2" },
      DOUBLE_ROOK,
    );
    expect(checking.check).toBe(true);
    expect(() => applyCandidate(
      fen,
      [],
      {
        from: "a2",
        to: "e2",
        second: { from: "e2", to: "e3" },
      },
      DOUBLE_ROOK,
    )).toThrow(IllegalMoveError);
  });

  it("supports two captures in one rook action and resets the halfmove clock", () => {
    const result = applyCandidate(
      "4k3/8/8/8/n2n4/8/8/R3K3 w - - 17 9",
      [],
      {
        from: "a1",
        to: "a4",
        second: { from: "a4", to: "d4" },
      },
      DOUBLE_ROOK,
    );
    expect(result.move.captured).toBe("n");
    expect(result.secondMove?.captured).toBe("n");
    expect(result.fenAfter.split(" ")[4]).toBe("0");
  });

  it("advances the fullmove counter once for a two-leg Black rook action", () => {
    const result = applyCandidate(
      "4k3/r7/8/8/8/8/8/4K3 b - - 0 12",
      [],
      {
        from: "a7",
        to: "a6",
        second: { from: "a6", to: "h6" },
      },
      DOUBLE_ROOK,
    );
    expect(result.fenAfter.split(" ")[5]).toBe("13");
  });

  it("commits two moves by the same knight as one atomic ply", () => {
    const result = applyCandidate(
      "4k3/8/8/8/8/8/1N6/4K3 w - - 0 1",
      [],
      {
        from: "b2",
        to: "c4",
        second: { from: "c4", to: "d6" },
      },
      DOUBLE_KNIGHT,
    );
    expect(result.move).toMatchObject({ from: "b2", to: "c4", piece: "n" });
    expect(result.secondMove).toMatchObject({ from: "c4", to: "d6", piece: "n" });
    expect(result.turn).toBe("b");
    expect(result.check).toBe(true);
    expect(new Chess(result.fenAfter).get("d6")).toMatchObject({
      color: "w",
      type: "n",
    });
  });

  it("requires the same knight for the second leg and ends a checking first leg", () => {
    expect(() => applyCandidate(
      "4k3/8/8/8/8/8/1N6/4K1N1 w - - 0 1",
      [],
      {
        from: "b2",
        to: "c4",
        second: { from: "g1", to: "f3" },
      },
      DOUBLE_KNIGHT,
    )).toThrow(IllegalMoveError);

    const checkingFen = "4k3/8/8/1N6/8/8/8/4K3 w - - 0 1";
    expect(applyCandidate(
      checkingFen,
      [],
      { from: "b5", to: "c7" },
      DOUBLE_KNIGHT,
    ).check).toBe(true);
    expect(() => applyCandidate(
      checkingFen,
      [],
      {
        from: "b5",
        to: "c7",
        second: { from: "c7", to: "a8" },
      },
      DOUBLE_KNIGHT,
    )).toThrow(IllegalMoveError);
  });

  it("allows a three-move rule to stop after one, two, or three legal legs", () => {
    const fen = "4k3/8/8/8/8/8/1N6/4K3 w - - 0 1";
    const one = applyCandidate(
      fen,
      [],
      { from: "b2", to: "c4" },
      TRIPLE_KNIGHT,
    );
    expect(one.continuationMoves).toHaveLength(0);
    expect(one.turn).toBe("b");

    const two = applyCandidate(
      fen,
      [],
      {
        from: "b2",
        to: "c4",
        continuation: [{ from: "c4", to: "a5" }],
      },
      TRIPLE_KNIGHT,
    );
    expect(two.continuationMoves).toHaveLength(1);
    expect(two.turn).toBe("b");

    const three = applyCandidate(
      fen,
      [],
      {
        from: "b2",
        to: "c4",
        continuation: [
          { from: "c4", to: "a5" },
          { from: "a5", to: "b7" },
        ],
      },
      TRIPLE_KNIGHT,
    );
    expect(three.continuationMoves).toHaveLength(2);
    expect(new Chess(three.fenAfter).get("b7")).toMatchObject({
      color: "w",
      type: "n",
    });
    expect(three.turn).toBe("b");
  });

  it("rejects a fourth leg, switching pieces, and continuing after check", () => {
    const fen = "4k3/8/8/8/8/8/1N6/4K1N1 w - - 0 1";
    expect(() => applyCandidate(
      fen,
      [],
      {
        from: "b2",
        to: "c4",
        continuation: [
          { from: "c4", to: "a5" },
          { from: "a5", to: "b7" },
          { from: "b7", to: "d8" },
        ],
      },
      TRIPLE_KNIGHT,
    )).toThrow(IllegalMoveError);
    expect(() => applyCandidate(
      fen,
      [],
      {
        from: "b2",
        to: "c4",
        continuation: [{ from: "g1", to: "f3" }],
      },
      TRIPLE_KNIGHT,
    )).toThrow(IllegalMoveError);

    const checkingFen = "4k3/8/8/8/8/8/1N6/4K3 w - - 0 1";
    expect(() => applyCandidate(
      checkingFen,
      [],
      {
        from: "b2",
        to: "c4",
        continuation: [
          { from: "c4", to: "d6" },
          { from: "d6", to: "f7" },
        ],
      },
      TRIPLE_KNIGHT,
    )).toThrow(IllegalMoveError);
  });

  it("fixes Magic eligibility and limit at turn start across promotion", () => {
    const result = applyCandidate(
      "4k3/P7/8/8/8/8/8/4K3 w - - 0 1",
      [],
      {
        from: "a7",
        to: "a8",
        promotion: "n",
        continuation: [
          { from: "a8", to: "b6" },
          { from: "b6", to: "a4" },
        ],
      },
      TRIPLE_PAWN,
    );
    expect(result.continuationMoves).toHaveLength(2);
    expect(new Chess(result.fenAfter).get("a4")).toMatchObject({
      color: "w",
      type: "n",
    });
  });

  it("blocks all pawn moves onto the final rank", () => {
    const fen = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";
    expect(() => applyCandidate(
      fen,
      [],
      { from: "a7", to: "a8", promotion: "q" },
      NO_PROMOTION,
    )).toThrow(IllegalMoveError);

    expect(() => applyCandidate(
      "1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1",
      [],
      { from: "a7", to: "b8", promotion: "q" },
      NO_PROMOTION,
    )).toThrow(IllegalMoveError);
  });

  it("disables castling without changing ordinary king moves", () => {
    const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    expect(() => applyCandidate(
      fen,
      [],
      { from: "e1", to: "g1" },
      NO_CASTLING,
    )).toThrow(IllegalMoveError);
    expect(
      applyCandidate(
        fen,
        [],
        { from: "e1", to: "f1" },
        NO_CASTLING,
      ).move.to,
    ).toBe("f1");
  });

  it("disables an otherwise legal en passant capture", () => {
    const fen = "k7/8/8/3pP3/8/8/8/4K3 w - d6 0 2";
    expect(applyCandidate(
      fen,
      [],
      { from: "e5", to: "d6" },
    ).move.isEnPassant()).toBe(true);
    expect(() => applyCandidate(
      fen,
      [],
      { from: "e5", to: "d6" },
      NO_EN_PASSANT,
    )).toThrow(IllegalMoveError);
  });

  it("uses Magic Rules when deciding stalemate", () => {
    const fen = "8/P7/8/8/8/5k2/6r1/7K w - - 0 1";
    const chess = new Chess(fen);
    expect(chess.isStalemate()).toBe(false);
    expect(analyzeTerminal(chess, 1, NO_PROMOTION)).toEqual({
      completed: true,
      winner: null,
      termination: "stalemate",
    });
  });
});
