import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CapturedPiecesPanel } from "./CapturedPiecesPanel";

describe("CapturedPiecesPanel", () => {
  it("renders every captured piece without an ellipsis or display cap", () => {
    const html = renderToStaticMarkup(createElement(CapturedPiecesPanel, {
      whiteCaptured: ["q", "r", "b", "n", "p", "p"],
      blackCaptured: ["r", "b", "n", "p", "p", "p", "p"],
    }));
    expect(html).toContain('data-captured-count="6"');
    expect(html).toContain('data-captured-count="7"');
    expect(html).not.toContain("…");
    expect(html).not.toContain("...");
  });
});
