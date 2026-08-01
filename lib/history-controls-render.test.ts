import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryControls } from "../app/ui/HistoryControls";

const noop = () => {};

describe("HistoryControls", () => {
  it("keeps accessible back and forward arrows visible at the live position", () => {
    const html = renderToStaticMarkup(createElement(HistoryControls, {
      currentPly: 4,
      viewingHistory: false,
      onBack: noop,
      onForward: noop,
    }));

    expect(html).toContain('aria-label="Move history"');
    expect(html).toContain('aria-label="Previous position"');
    expect(html).toContain('aria-label="Next position"');
    expect(html).not.toContain("GO LIVE");
  });

  it("uses the forward arrow to return through historical plies", () => {
    const html = renderToStaticMarkup(createElement(HistoryControls, {
      currentPly: 2,
      viewingHistory: true,
      onBack: noop,
      onForward: noop,
    }));

    expect(html).toContain('aria-label="Next position"');
    expect(html).not.toContain("GO LIVE");
  });

  it("keeps Back enabled for a staged first-ply Magic move", () => {
    const html = renderToStaticMarkup(createElement(HistoryControls, {
      currentPly: 0,
      viewingHistory: false,
      canStepBackFromDraft: true,
      onBack: noop,
      onForward: noop,
    }));

    const previousButton = html.match(
      /<button[^>]*aria-label="Previous position"[^>]*>/,
    )?.[0];

    expect(previousButton).toBeDefined();
    expect(previousButton).not.toContain("disabled");
  });
});
