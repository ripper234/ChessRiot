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

    expect(html).toContain('dir="ltr"');
    expect(html).toContain('aria-label="היסטוריית מהלכים"');
    expect(html).toContain('aria-label="העמדה הקודמת"');
    expect(html).toContain('aria-label="העמדה הבאה"');
    expect(html).not.toContain("GO LIVE");
  });

  it("uses the forward arrow to return through historical plies", () => {
    const html = renderToStaticMarkup(createElement(HistoryControls, {
      currentPly: 2,
      viewingHistory: true,
      onBack: noop,
      onForward: noop,
    }));

    expect(html).toContain('aria-label="העמדה הבאה"');
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
      /<button[^>]*aria-label="העמדה הקודמת"[^>]*>/,
    )?.[0];

    expect(previousButton).toBeDefined();
    expect(previousButton).not.toContain("disabled");
  });
});
