import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import type { PublicMove } from "./game-types";
import {
  capturedPiecesByVictimColor,
  checkedKingSquare,
  illegalDestinationMessage,
  isDarkSquare,
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
});
