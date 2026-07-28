import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BoardEffect } from "@/lib/game-effects";
import { orientedBoardSquares } from "@/lib/game-presentation";
import { BoardActionAnimation } from "./BoardActionAnimation";

function captureEffect(attacker: "p" | "n"): BoardEffect {
  return {
    id: `test:${attacker}`,
    ply: 1,
    leg: "first",
    from: attacker === "n" ? "b2" : "c3",
    to: attacker === "n" ? "d3" : "d4",
    capture: true,
    beforeFen: "",
    afterFen: "",
    attacker: { color: "w", type: attacker },
    victim: { color: "b", type: "r", square: attacker === "n" ? "d3" : "d4" },
  };
}

describe("BoardActionAnimation", () => {
  it("renders the attacker, weapon, victim, and impact as a hidden visual layer", () => {
    const html = renderToStaticMarkup(
      <BoardActionAnimation
        effect={captureEffect("p")}
        squares={orientedBoardSquares("w")}
      />,
    );

    expect(html).toContain('class="board-action-animation is-capture"');
    expect(html).toContain('data-attacker="p"');
    expect(html).toContain('data-victim="r"');
    expect(html).toContain('class="action-weapon"');
    expect(html).toContain('class="action-unit action-victim piece-b"');
    expect(html).toContain('class="action-impact"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("--action-x");
  });

  it("marks the knight leap and explicit reduced-motion simulation", () => {
    const html = renderToStaticMarkup(
      <BoardActionAnimation
        effect={captureEffect("n")}
        squares={orientedBoardSquares("b")}
        reducedMotion
      />,
    );

    expect(html).toContain("is-reduced");
    expect(html).toContain('data-attacker="n"');
    expect(html).toContain('class="action-reduced-marker"');
  });
});
