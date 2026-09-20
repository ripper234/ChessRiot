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
    special: { castle: false, check: false, queenCapture: false, promotion: null, greatMove: null },
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

  it("holds capture feedback long enough to read and keeps a reduced-motion marker", () => {
    expect(boardActionDuration(effect("p"))).toBe(CAPTURE_ACTION_MS);
    expect(boardActionDuration(effect("p", false))).toBe(MOVE_ACTION_MS);
    expect(boardActionDuration(effect("n"), true)).toBe(REDUCED_ACTION_MS);
    expect(CAPTURE_ACTION_MS).toBe(1_400);
    expect(REDUCED_ACTION_MS).toBeGreaterThanOrEqual(400);

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

  it("renders every special celebration in Hebrew for the protected game room", () => {
    const special = effect("q");
    special.special = {
      castle: true,
      check: true,
      queenCapture: true,
      promotion: "q",
      greatMove: { kind: "fork", label: "FORK!" },
    };
    const hebrew = renderToStaticMarkup(
      <BoardActionAnimation
        effect={special}
        squares={orientedBoardSquares("w")}
        locale="he"
      />,
    );

    expect(hebrew).toContain('lang="he"');
    expect(hebrew).toContain('dir="rtl"');
    for (const label of ["הצרחה", "שח!", "המלכה נפלה", "המלכה עולה", "מזלג!", "התקפה כפולה"]) {
      expect(hebrew).toContain(label);
    }
    expect(hebrew).not.toMatch(/CASTLE|CHECK!|QUEEN DOWN|QUEEN RISES|FORK!|DOUBLE ATTACK/);

    special.special.greatMove = { kind: "material", label: "GREAT WIN" };
    const material = renderToStaticMarkup(
      <BoardActionAnimation
        effect={special}
        squares={orientedBoardSquares("w")}
        locale="he"
      />,
    );
    expect(material).toContain("זכייה גדולה");
    expect(material).toContain("זכייה בחומר");
    expect(material).not.toContain("GREAT WIN");
  });
});
