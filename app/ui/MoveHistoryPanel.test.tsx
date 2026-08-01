import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicMove } from "@/lib/game-types";
import { currentMoveLabel, MoveHistoryPanel } from "./MoveHistoryPanel";

const moves: PublicMove[] = [
  { ply: 1, color: "w", from: "e2", to: "e4", promotion: null, san: "e4", createdAt: "2026-08-01" },
  { ply: 2, color: "b", from: "d7", to: "d5", promotion: null, san: "d5", createdAt: "2026-08-01" },
  { ply: 3, color: "w", from: "e4", to: "d5", promotion: null, san: "exd5", createdAt: "2026-08-01" },
];

describe("MoveHistoryPanel", () => {
  it("summarizes the currently viewed move and marks captures with swords", () => {
    expect(currentMoveLabel(moves, 3)).toBe("2. White ⚔ exd5");
    const html = renderToStaticMarkup(createElement(MoveHistoryPanel, { moves, currentPly: 3 }));
    expect(html).toContain("MOVE HISTORY");
    expect(html).toContain("⚔ exd5");
    expect(html).toContain("data-current=\"true\"");
  });

  it("stays collapsed by default", () => {
    const html = renderToStaticMarkup(createElement(MoveHistoryPanel, { moves, currentPly: 1 }));
    expect(html).toContain("<details class=\"side-card move-history-panel\">");
    expect(html).not.toContain("<details open");
  });
});
