import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import {
  INITIAL_FEN,
  IllegalMoveError,
  analyzeTerminal,
  applyCandidate,
  replayGame,
  type CandidateMove,
} from "./game-rules";
import type { Promotion } from "./game-types";

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

  it("recognizes threefold repetition from replayed history", () => {
    const result = play(INITIAL_FEN, [
      { from: "g1", to: "f3" }, { from: "g8", to: "f6" },
      { from: "f3", to: "g1" }, { from: "f6", to: "g8" },
      { from: "g1", to: "f3" }, { from: "g8", to: "f6" },
      { from: "f3", to: "g1" }, { from: "f6", to: "g8" },
    ]).last;
    expect(result?.termination).toBe("threefold_repetition");
  });

  it("recognizes the fifty-move rule", () => {
    const result = applyCandidate("8/8/8/8/8/8/R6k/K7 w - - 99 50", [], { from: "a2", to: "a3" });
    expect(result.termination).toBe("fifty_move");
  });
});
