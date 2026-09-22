import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GameHistory } from "./GameHistory";

describe("game history filter styles", () => {
  it("keeps native radio labels while preventing invisible input overlap", () => {
    const html = renderToStaticMarkup(<GameHistory />);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/<label[^>]*><input[^>]*name="history-mode"[^>]*\/>All<\/label>/);
    const css = readFileSync(new URL("../globals.css", import.meta.url), "utf8");
    const input = css.match(/\.history-filters fieldset input \{([^}]*)\}/)?.[1];
    // Global form styles otherwise create full-width invisible hit targets.
    expect(input).toMatch(/pointer-events:\s*none/);
    expect(input).toMatch(/width:\s*1px/);
    expect(input).toMatch(/min-height:\s*0/);
    expect(input).toMatch(/padding:\s*0/);
  });
  it("keeps the selected mode legible without a duplicate text shadow", () => {
    const css = readFileSync(new URL("../globals.css", import.meta.url), "utf8");
    const selected = css.match(
      /\.history-filters fieldset label\[data-selected="true"\] \{([^}]*)\}/,
    )?.[1];

    expect(selected).toMatch(/color:\s*#172515/);
    expect(selected).toMatch(/background:\s*var\(--chess-gold\)/);
    expect(selected).toMatch(/text-shadow:\s*none/);
  });
});
