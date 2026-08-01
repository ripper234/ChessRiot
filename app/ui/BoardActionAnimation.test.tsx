import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PieceSymbol } from "chess.js";
import type { BoardEffect } from "@/lib/game-effects";
import { orientedBoardSquares } from "@/lib/game-presentation";
import {
  boardActionDuration,
  BoardActionAnimation,
  CAPTURE_ACTION_MS,
  MOVE_ACTION_MS,
  REDUCED_ACTION_MS,
} from "./BoardActionAnimation";

function effect(attacker: PieceSymbol, capture = true): BoardEffect {
  return {
    id: `test:${attacker}`,
    ply: 1,
    leg: "first",
    from: attacker === "n" ? "b2" : "c3",
    to: attacker === "n" ? "d3" : "d4",
    capture,
    beforeFen: "",
    afterFen: "",
    attacker: { color: "w", type: attacker },
    victim: capture
      ? { color: "b", type: "r", square: attacker === "n" ? "d3" : "d4" }
      : null,
  };
}

describe("BoardActionAnimation", () => {
  it.each(["p", "n", "b", "r", "q", "k"] as PieceSymbol[])(
    "renders a distinct %s combat identity on both board orientations",
    (attacker) => {
      for (const orientation of ["w", "b"] as const) {
        const html = renderToStaticMarkup(
          <BoardActionAnimation
            effect={effect(attacker)}
            squares={orientedBoardSquares(orientation)}
          />,
        );
        expect(html).toContain(`data-attacker="${attacker}"`);
        expect(html).toContain('class="action-unit action-victim piece-b"');
        expect(html).toContain('class="action-impact"');
        expect(html).toContain("--action-angle");
        expect(html).toContain('aria-hidden="true"');
      }
    },
  );

  it("uses short, non-blocking durations and a reduced-motion fallback", () => {
    expect(boardActionDuration(effect("p"))).toBe(CAPTURE_ACTION_MS);
    expect(boardActionDuration(effect("p", false))).toBe(MOVE_ACTION_MS);
    expect(boardActionDuration(effect("n"), true)).toBe(REDUCED_ACTION_MS);

    const html = renderToStaticMarkup(
      <BoardActionAnimation
        effect={effect("n")}
        squares={orientedBoardSquares("w")}
        reducedMotion
      />,
    );
    expect(html).toContain("is-reduced");
    expect(html).toContain('class="action-reduced-marker"');
  });
});
