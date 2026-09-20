import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotificationTurnTest } from "./NotificationTurnTest";

describe("notification test introduction", () => {
  it("opens in English with one primary action and optional full explanation", () => {
    const html = renderToStaticMarkup(<NotificationTurnTest />);
    expect(html).toContain('lang="en" dir="ltr"');
    expect(html).toContain("Test your notifications");
    expect((html.match(/<button /g) ?? []).length).toBe(1);
    expect(html).toMatch(/<details[^>]*><summary>How the test works<\/summary>/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain("four rounds");
    expect(html).toContain("only to this phone");
    expect(html).toContain("Do not use Android");
  });
});
