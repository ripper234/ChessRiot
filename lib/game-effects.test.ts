import { Chess, type Square } from "chess.js";
import { describe, expect, it } from "vitest";
import type { GameSnapshot, Promotion, PublicMove } from "./game-types";
import { boardEffects, moveBoardEffects } from "./game-effects";

interface Candidate {
  from: Square;
  to: Square;
  promotion?: Promotion;
}

function playedMoves(candidates: Candidate[]): PublicMove[] {
  const chess = new Chess();
  return candidates.map((candidate, index) => {
    const fenBefore = chess.fen();
    const move = chess.move(candidate);
    return {
      ply: index + 1,
      color: move.color,
      from: move.from,
      to: move.to,
      promotion: candidate.promotion ?? null,
      san: move.san,
      fenBefore,
      fenAfter: chess.fen(),
      createdAt: `2026-07-24T00:00:0${index}.000Z`,
    };
  });
}

function snapshot(moves: PublicMove[]): GameSnapshot {
  const initialFen = new Chess().fen();
  const fen = moves.at(-1)?.fenAfter ?? initialFen;
  return {
    id: "game",
    mode: "multiplayer",
    variantId: "standard",
    aiDifficulty: null,
    status: "active",
    version: moves.length,
    initialFen,
    fen,
    turn: new Chess(fen).turn(),
    plyCount: moves.length,
    players: { white: { name: "White" }, black: { name: "Black" } },
    you: { color: "w", name: "White" },
    check: false,
    claimableDraws: [],
    outcome: null,
    moves,
    updatedAt: "2026-07-24T00:00:00.000Z",
  };
}

const moves = playedMoves([
  { from: "e2", to: "e4" },
  { from: "d7", to: "d5" },
  { from: "e4", to: "d5" },
]);

describe("boardEffects", () => {
  it("does not animate an initial load or unchanged poll", () => {
    expect(boardEffects(null, snapshot(moves))).toEqual([]);
    expect(boardEffects(snapshot(moves), snapshot(moves))).toEqual([]);
  });

  it("returns every newly committed move in chronological order", () => {
    const effects = boardEffects(snapshot(moves.slice(0, 1)), snapshot(moves));

    expect(effects).toHaveLength(2);
    expect(effects[0]).toMatchObject({
      id: "2:first:d7-d5",
      from: "d7",
      to: "d5",
      capture: false,
      attacker: { color: "b", type: "p" },
      victim: null,
    });
    expect(effects[1]).toMatchObject({
      id: "3:first:e4-d5",
      from: "e4",
      to: "d5",
      capture: true,
      attacker: { color: "w", type: "p" },
      victim: { color: "b", type: "p", square: "d5" },
    });
  });

  it("animates an optimistic move once and only a later reply afterward", () => {
    const before = snapshot([]);
    const humanPreview = snapshot(moves.slice(0, 1));
    const committedHuman = { ...humanPreview, version: humanPreview.version + 1 };
    const finalReply = snapshot(moves.slice(0, 2));

    expect(boardEffects(before, humanPreview).map((effect) => effect.id)).toEqual([
      "1:first:e2-e4",
    ]);
    expect(boardEffects(humanPreview, committedHuman)).toEqual([]);
    expect(boardEffects(committedHuman, finalReply).map((effect) => effect.id)).toEqual([
      "2:first:d7-d5",
    ]);
  });

  it("keeps the real victim square for en passant", () => {
    const sequence = playedMoves([
      { from: "e2", to: "e4" },
      { from: "a7", to: "a6" },
      { from: "e4", to: "e5" },
      { from: "d7", to: "d5" },
      { from: "e5", to: "d6" },
    ]);
    const effect = moveBoardEffects(sequence.at(-1)!, sequence.at(-2)!.fenAfter!)[0];

    expect(effect).toMatchObject({
      from: "e5",
      to: "d6",
      capture: true,
      attacker: { color: "w", type: "p" },
      victim: { color: "b", type: "p", square: "d5" },
    });
  });

  it("attacks as a pawn before revealing a capture promotion", () => {
    const fenBefore = "4k2r/6P1/8/8/8/8/8/4K3 w - - 0 1";
    const chess = new Chess(fenBefore);
    const move = chess.move({ from: "g7", to: "h8", promotion: "q" });
    const effect = moveBoardEffects({
      ply: 1,
      color: "w",
      from: "g7",
      to: "h8",
      promotion: "q",
      san: move.san,
      fenBefore,
      fenAfter: chess.fen(),
      createdAt: "2026-07-24T00:00:00.000Z",
    }, fenBefore)[0];

    expect(effect).toMatchObject({
      attacker: { color: "w", type: "p" },
      victim: { color: "b", type: "r", square: "h8" },
    });
    expect(new Chess(effect.afterFen).get("h8")).toMatchObject({ color: "w", type: "q" });
  });

  it("emits both legs of an atomic Magic capture", () => {
    const fenBefore = "7k/8/8/p7/8/p7/8/R6K w - - 0 1";
    const effects = moveBoardEffects({
      ply: 1,
      color: "w",
      from: "a1",
      to: "a3",
      promotion: null,
      san: "Rxa3",
      second: { from: "a3", to: "a5", san: "Rxa5" },
      fenBefore,
      createdAt: "2026-07-24T00:00:00.000Z",
    }, fenBefore);

    expect(effects.map((effect) => ({ id: effect.id, victim: effect.victim }))).toEqual([
      { id: "1:first:a1-a3", victim: { color: "b", type: "p", square: "a3" } },
      { id: "1:second:a3-a5", victim: { color: "b", type: "p", square: "a5" } },
    ]);
  });

  it("skips presentation safely when stored history cannot be reconstructed", () => {
    expect(moveBoardEffects({
      ply: 1,
      color: "w",
      from: "e2",
      to: "e4",
      promotion: null,
      san: "e4",
      fenBefore: "not a chess position",
      createdAt: "2026-07-24T00:00:00.000Z",
    }, new Chess().fen())).toEqual([]);
  });
});
