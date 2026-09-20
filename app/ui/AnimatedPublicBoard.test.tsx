import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnimatedPublicBoard } from "./AnimatedPublicBoard";

describe("AnimatedPublicBoard", () => {
  it("maps the four opening moves to their exact source squares", () => {
    const html = renderToStaticMarkup(<AnimatedPublicBoard />);

    expect(html.match(/data-square=/g)).toHaveLength(64);
    expect(html).toMatch(/data-square="b8"[^>]*><i class="home-move-b8-c6"/);
    expect(html).toMatch(/data-square="e7"[^>]*><i class="home-move-e7-e5"/);
    expect(html).toMatch(/data-square="e2"[^>]*><i class="home-move-e2-e4"/);
    expect(html).toMatch(/data-square="g1"[^>]*><i class="home-move-g1-f3"/);
  });

  it("uses full-square motion geometry and an invisible reset", () => {
    const css = readFileSync(new URL("../board.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.public-board > span > i \{[\s\S]*?width: 100%;[\s\S]*?height: 100%;/);
    expect(css).toMatch(/\.public-board \.chess-piece-svg \{ width: 84%; height: 84%; \}/);
    expect(css.match(/87\.01%, 94% \{ transform: translate\(0,0\); opacity: 0; \}/g)).toHaveLength(4);
  });
});
