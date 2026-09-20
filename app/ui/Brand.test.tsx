import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Brand } from "./Brand";

describe("Brand locale", () => {
  it("keeps the public default English and renders protected Hebrew on request", () => {
    const english = renderToStaticMarkup(<Brand />);
    const hebrew = renderToStaticMarkup(<Brand locale="he" />);

    expect(english).toContain("REAL CHESS. TOTAL PLAY.");
    expect(english).toContain('aria-label="ChessRiot home"');
    expect(hebrew).toContain("שחמט אמיתי. משחק מלא.");
    expect(hebrew).toContain('class="brand-name" dir="ltr"');
    expect(hebrew).toContain('aria-label="דף הבית של ChessRiot"');
    expect(hebrew).not.toContain("REAL CHESS. TOTAL PLAY.");
  });
});
