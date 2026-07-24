import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { classifyGameFinisher } from "./game-finishers";
import type {
  Color,
  GameSnapshot,
  Promotion,
  PublicMove,
  Termination,
} from "./game-types";

function checkmateTransition(
  moves: string[],
  viewerColor: Color,
): { previous: GameSnapshot; next: GameSnapshot } {
  const chess = new Chess();
  const history: PublicMove[] = [];

  for (const [index, notation] of moves.slice(0, -1).entries()) {
    const move = chess.move(notation);
    history.push({
      ply: index + 1,
      color: move.color,
      from: move.from,
      to: move.to,
      promotion: (move.promotion as Promotion | undefined) ?? null,
      san: move.san,
      createdAt: `2026-07-24T00:00:0${index}.000Z`,
    });
  }

  const previous = snapshot({
    fen: chess.fen(),
    turn: chess.turn(),
    plyCount: history.length,
    moves: [...history],
    you: { color: viewerColor, name: viewerColor === "w" ? "White" : "Black" },
  });
  const checkmatingMove = chess.move(moves.at(-1)!);
  history.push({
    ply: history.length + 1,
    color: checkmatingMove.color,
    from: checkmatingMove.from,
    to: checkmatingMove.to,
    promotion: (checkmatingMove.promotion as Promotion | undefined) ?? null,
    san: checkmatingMove.san,
    createdAt: "2026-07-24T00:00:09.000Z",
  });

  const next = snapshot({
    status: "completed",
    version: previous.version + 1,
    fen: chess.fen(),
    turn: chess.turn(),
    plyCount: history.length,
    moves: history,
    outcome: {
      winner: checkmatingMove.color,
      reason: "checkmate",
    },
    you: previous.you,
  });
  return { previous, next };
}

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  return {
    id: "game",
    mode: "multiplayer",
    aiDifficulty: null,
    status: "active",
    version: 3,
    fen: new Chess().fen(),
    turn: "w",
    plyCount: 0,
    players: { white: { name: "White" }, black: { name: "Black" } },
    you: { color: "w", name: "White" },
    check: false,
    claimableDraws: [],
    outcome: null,
    moves: [],
    updatedAt: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

describe("game finishers", () => {
  it("identifies Black's live checkmating piece and the losing king", () => {
    const { previous, next } = checkmateTransition(["f3", "e5", "g4", "Qh4#"], "w");

    expect(classifyGameFinisher(previous, next)).toEqual({
      type: "checkmate",
      winner: "b",
      loser: "w",
      attackingPiece: "q",
      attackingFrom: "d8",
      attackingTo: "h4",
      losingKingSquare: "e1",
    });
  });

  it("works for either winner and either viewer side", () => {
    const whiteViewer = checkmateTransition(
      ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"],
      "w",
    );
    const blackViewer = {
      previous: { ...whiteViewer.previous, you: { color: "b" as const, name: "Black" } },
      next: { ...whiteViewer.next, you: { color: "b" as const, name: "Black" } },
    };

    expect(classifyGameFinisher(whiteViewer.previous, whiteViewer.next)).toMatchObject({
      winner: "w",
      loser: "b",
      attackingPiece: "q",
      attackingFrom: "h5",
      attackingTo: "f7",
      losingKingSquare: "e8",
    });
    expect(classifyGameFinisher(blackViewer.previous, blackViewer.next))
      .toEqual(classifyGameFinisher(whiteViewer.previous, whiteViewer.next));
  });

  it("does not replay on initial load or completed-snapshot refresh", () => {
    const { previous, next } = checkmateTransition(["f3", "e5", "g4", "Qh4#"], "w");

    expect(classifyGameFinisher(null, next)).toBeNull();
    expect(classifyGameFinisher(next, next)).toBeNull();
    expect(classifyGameFinisher(previous, previous)).toBeNull();
    expect(classifyGameFinisher({ ...previous, status: "waiting" }, next)).toBeNull();
  });

  it.each<Termination>([
    "resignation",
    "stalemate",
    "insufficient_material",
    "threefold_repetition",
    "fivefold_repetition",
    "fifty_move",
    "seventy_five_move",
    "cancelled",
    "draw",
  ])("does not run for %s", (reason) => {
    const { previous, next } = checkmateTransition(["f3", "e5", "g4", "Qh4#"], "w");
    const outcome = reason === "resignation"
      ? { winner: "b" as const, reason }
      : { winner: null, reason };

    expect(classifyGameFinisher(previous, { ...next, outcome })).toBeNull();
  });

  it("requires a newly committed winning move", () => {
    const { previous, next } = checkmateTransition(["f3", "e5", "g4", "Qh4#"], "w");

    expect(classifyGameFinisher(
      { ...previous, plyCount: next.plyCount },
      next,
    )).toBeNull();
    expect(classifyGameFinisher(previous, {
      ...next,
      moves: next.moves.map((move, index) =>
        index === next.moves.length - 1 ? { ...move, color: "w" } : move),
    })).toBeNull();
  });
});
