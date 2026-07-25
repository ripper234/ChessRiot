import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryControls } from "../app/ui/HistoryControls";

const noop = () => {};

describe("HistoryControls", () => {
  it("keeps accessible back and forward arrows visible at the live position", () => {
    const html = renderToStaticMarkup(createElement(HistoryControls, {
      currentPly: 4,
      latestPly: 4,
      viewingHistory: false,
      onBack: noop,
      onForward: noop,
      onLive: noop,
    }));

    expect(html).toContain('aria-label="Move history"');
    expect(html).toContain('aria-label="Previous position"');
    expect(html).toContain('aria-label="Next position"');
    expect(html).toContain('aria-label="Live position"');
    expect(html).toContain("LIVE");
  });

  it("offers a direct return to live while browsing a historical ply", () => {
    const html = renderToStaticMarkup(createElement(HistoryControls, {
      currentPly: 2,
      latestPly: 7,
      viewingHistory: true,
      onBack: noop,
      onForward: noop,
      onLive: noop,
    }));

    expect(html).toContain('aria-label="Return to live position"');
    expect(html).toContain("2/7 · GO LIVE");
  });
});
