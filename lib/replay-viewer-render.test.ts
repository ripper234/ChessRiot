import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReplayViewer } from "../app/ui/ReplayViewer";
import type { PublicMagicRules } from "./magic-rules";

const MAGIC_RULES: PublicMagicRules = {
  version: 1,
  prompt: "Rooks move twice. No castling.",
  labels: [
    "Rooks may move twice; check ends the turn",
    "No castling",
  ],
  rules: [
    { kind: "double_move", piece: "r" },
    { kind: "no_castling" },
  ],
};

describe("ReplayViewer", () => {
  it("keeps every active Magic Rule visible in replay", () => {
    const html = renderToStaticMarkup(createElement(ReplayViewer, {
      moves: [],
      orientation: "w",
      magicRules: MAGIC_RULES,
    }));
    expect(html).toContain("Rooks may move twice; check ends the turn");
    expect(html).toContain("No castling");
  });

  it("does not add a Magic notice to a standard game", () => {
    const html = renderToStaticMarkup(createElement(ReplayViewer, {
      moves: [],
      orientation: "w",
      magicRules: null,
    }));
    expect(html).not.toContain("MAGIC RULES");
  });
});
