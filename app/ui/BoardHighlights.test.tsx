import { readFileSync } from "node:fs";
import { Chess } from "chess.js";
import { describe, expect, it } from "vitest";
import { legalMagicMoves } from "@/lib/game-rules";

describe("board move highlights", () => {
  it("keeps every legal knight destination available to the board", () => {
    const chess = new Chess("4k3/8/8/8/8/8/1N6/4K3 w - - 0 1");
    expect(legalMagicMoves(chess, null, "b2").map((move) => move.to).sort())
      .toEqual(["a4", "c4", "d1", "d3"]);
  });

  it("renders destination markers above pieces and board overlays", () => {
    const css = readFileSync(new URL("../board.css", import.meta.url), "utf8");
    const legalTarget = css.match(/\.game-shell \.square\.legal-target::after \{([\s\S]*?)\}/)?.[1];
    const captureTarget = css.match(/\.game-shell \.square\.capture-target::after \{([\s\S]*?)\}/)?.[1];

    expect(legalTarget).toMatch(/position:\s*absolute/);
    expect(legalTarget).toMatch(/z-index:\s*5/);
    expect(legalTarget).toMatch(/pointer-events:\s*none/);
    expect(captureTarget).toMatch(/z-index:\s*5/);
    expect(captureTarget).toMatch(/pointer-events:\s*none/);
  });
});
