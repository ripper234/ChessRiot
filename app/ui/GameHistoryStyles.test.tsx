import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("game history filter styles", () => {
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
