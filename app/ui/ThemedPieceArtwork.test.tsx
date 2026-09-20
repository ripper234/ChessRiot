import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PieceSymbol } from "chess.js";
import { describe, expect, it } from "vitest";
import { ThemedPieceArtwork } from "./ThemedPieceArtwork";

const MYTHIC_IDENTITIES: Record<PieceSymbol, string> = {
  p: "salamander",
  n: "griffin",
  b: "basilisk",
  r: "golem",
  q: "phoenix",
  k: "dragon",
};

describe("Mythic Beasts piece artwork", () => {
  it("gives every chess role a distinct creature identity", () => {
    const rendered = Object.entries(MYTHIC_IDENTITIES).map(([type, identity]) => {
      const html = renderToStaticMarkup(createElement(
        "svg",
        { viewBox: "0 0 100 100" },
        createElement(ThemedPieceArtwork, {
          type: type as PieceSymbol,
          theme: "mythic-beasts",
        }),
      ));
      expect(html).toContain(`data-mythic-beast="${identity}"`);
      return html;
    });

    expect(new Set(rendered).size).toBe(6);
  });
});

