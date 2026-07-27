import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PieceSymbol } from "chess.js";
import { describe, expect, it } from "vitest";
import { ChessPiece } from "../app/ui/ChessPiece";

const PIECES: PieceSymbol[] = ["p", "n", "b", "r", "q", "k"];

describe("ChessPiece", () => {
  it.each(PIECES)("renders a consistent flat SVG for %s", (type) => {
    const html = renderToStaticMarkup(createElement(ChessPiece, {
      type,
      color: "w",
    }));

    expect(html).toContain("<svg");
    expect(html).toContain(`data-piece="${type}"`);
    expect(html).toContain("chess-piece-svg piece-w");
    expect(html).toContain('viewBox="0 0 100 100"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
    expect(html).toContain("piece-silhouette");
  });

  it("uses one geometry with a color-specific class", () => {
    const white = renderToStaticMarkup(createElement(ChessPiece, {
      type: "q",
      color: "w",
    }));
    const black = renderToStaticMarkup(createElement(ChessPiece, {
      type: "q",
      color: "b",
    }));

    expect(white.replace("piece-w", "piece-b")).toBe(black);
  });
});
