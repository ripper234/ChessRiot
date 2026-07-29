import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import type { GameSnapshot, PublicMove } from "./game-types";
import {
  actionEndpointSquares,
  capturedPiecesByVictimColor,
  CHESS_PIECE_GLYPHS,
  CHESS_PIECE_NAMES,
  checkedKingSquare,
  DIFFICULTY_LABELS,
  gameStatusText,
  illegalDestinationMessage,
  isDarkSquare,
  orientedBoardSquares,
  outcomeText,
  pieceCannotAnswerCheckMessage,
} from "./game-presentation";

function move(
  ply: number,
  color: "w" | "b",
  from: string,
  to: string,
  san: string,
  promotion: PublicMove["promotion"] = null,
): PublicMove {
  return {
    ply,
    color,
    from,
    to,
    promotion,
    san,
    createdAt: "2026-07-24T00:00:00.000Z",
  };
}

describe("capturedPiecesByVictimColor", () => {
  it("groups captured pieces by the color that lost them", () => {
    expect(capturedPiecesByVictimColor([
      move(1, "w", "e2", "e4", "e4"),
      move(2, "b", "d7", "d5", "d5"),
      move(3, "w", "e4", "d5", "exd5"),
      move(4, "b", "d8", "d5", "Qxd5"),
    ])).toEqual({ w: ["p"], b: ["p"] });
  });

  it("keeps an asymmetric capture with the victim's color", () => {
    expect(capturedPiecesByVictimColor([
      move(1, "w", "e2", "e4", "e4"),
      move(2, "b", "d7", "d5", "d5"),
      move(3, "w", "e4", "d5", "exd5"),
    ])).toEqual({ w: [], b: ["p"] });
  });

  it("includes en passant captures", () => {
    expect(capturedPiecesByVictimColor([
      move(1, "w", "e2", "e4", "e4"),
      move(2, "b", "a7", "a6", "a6"),
      move(3, "w", "e4", "e5", "e5"),
      move(4, "b", "d7", "d5", "d5"),
      move(5, "w", "e5", "d6", "exd6"),
    ])).toEqual({ w: [], b: ["p"] });
  });

  it("includes a capture made while promoting", () => {
    expect(capturedPiecesByVictimColor([
      move(1, "w", "a7", "b8", "axb8=Q+", "q"),
    ], "1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1")).toEqual({
      w: [],
      b: ["r"],
    });
  });

  it("reconstructs captures from a Mini Game starting setup", () => {
    expect(capturedPiecesByVictimColor([
      move(1, "w", "c2", "c4", "c4"),
      move(2, "b", "d7", "d5", "d5"),
      move(3, "w", "c4", "d5", "cxd5"),
    ], "4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1")).toEqual({
      w: [],
      b: ["p"],
    });
  });

  it("identifies the king that is currently in check", () => {
    expect(checkedKingSquare(new Chess("4k3/8/8/8/8/8/4R3/4K3 b - - 0 1")))
      .toBe("e8");
    expect(checkedKingSquare(new Chess())).toBeNull();
  });

  it("explains that an illegal move must answer check", () => {
    expect(illegalDestinationMessage(true)).toMatch(/in check/i);
    expect(illegalDestinationMessage(false)).toMatch(/highlighted/i);
    expect(pieceCannotAnswerCheckMessage()).toMatch(/cannot stop the check/i);
  });
});

describe("board colors", () => {
  it("keeps a1 and h8 dark, and a8 and h1 light", () => {
    expect(isDarkSquare("a1")).toBe(true);
    expect(isDarkSquare("h8")).toBe(true);
    expect(isDarkSquare("a8")).toBe(false);
    expect(isDarkSquare("h1")).toBe(false);
  });

  it("uses one orientation helper for both board directions", () => {
    const white = orientedBoardSquares("w");
    const black = orientedBoardSquares("b");
    expect(white).toHaveLength(64);
    expect(white[0]).toBe("a8");
    expect(white.at(-1)).toBe("h1");
    expect(black[0]).toBe("h1");
    expect(black.at(-1)).toBe("a8");
    expect(black).toEqual([...white].reverse());
  });

  it("keeps shared piece and difficulty labels stable", () => {
    expect(CHESS_PIECE_GLYPHS.w.n).toBe("♞");
    expect(CHESS_PIECE_GLYPHS.b.k).toBe("♚");
    expect(CHESS_PIECE_NAMES.q).toBe("queen");
    expect(DIFFICULTY_LABELS[3]).toBe("Medium");
  });
});

describe("move presentation", () => {
  it("highlights the start and final square of an atomic rook action", () => {
    expect(actionEndpointSquares({
      from: "a1",
      to: "a3",
      second: { from: "a3", to: "h3", san: "Rh3" },
    })).toEqual(["a1", "h3"]);
  });
});

describe("outcome presentation", () => {
  function gameWithOutcome(
    outcome: GameSnapshot["outcome"],
  ): GameSnapshot {
    return {
      id: "game",
      mode: "multiplayer",
      variantId: "standard",
      aiDifficulty: null,
      status: "completed",
      version: 1,
      initialFen: new Chess().fen(),
      fen: new Chess().fen(),
      turn: "b",
      plyCount: 1,
      players: {
        white: { name: "White player" },
        black: { name: "Black player" },
      },
      you: { color: "w", name: "White player" },
      check: false,
      claimableDraws: [],
      outcome,
      moves: [],
      updatedAt: "2026-07-26T00:00:00.000Z",
    };
  }

  it("formats decisive and drawn outcomes without UI-specific logic", () => {
    expect(outcomeText(gameWithOutcome({
      winner: "w",
      reason: "checkmate",
    }))).toBe("White player wins by checkmate");
    expect(outcomeText(gameWithOutcome({
      winner: "b",
      reason: "timeout",
    }))).toBe("Black player wins on time");
    expect(outcomeText(gameWithOutcome({
      winner: null,
      reason: "threefold_repetition",
    }))).toBe("Draw by repetition");
  });

  it("keeps live, check, history, and Magic status precedence explicit", () => {
    const game = gameWithOutcome(null);
    game.status = "active";
    game.turn = "w";

    expect(gameStatusText({
      game,
      viewingHistory: true,
      historyLabel: "Move 1 of 4",
      openingIntro: true,
      magicPiece: "n",
      displayCheck: true,
    })).toBe("Move 1 of 4");
    expect(gameStatusText({
      game,
      viewingHistory: false,
      historyLabel: "",
      openingIntro: false,
      magicPiece: "n",
      displayCheck: true,
    })).toBe("Magic turn: move that knight again or finish");
    expect(gameStatusText({
      game,
      viewingHistory: false,
      historyLabel: "",
      openingIntro: false,
      displayCheck: true,
    })).toBe("CHECK! Protect your king");
    expect(gameStatusText({
      game,
      viewingHistory: false,
      historyLabel: "",
      openingIntro: false,
      displayCheck: false,
    })).toBe("Your turn");
  });
});
