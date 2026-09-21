import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { translate, type Locale } from "@/lib/locale";
const language = vi.hoisted(() => ({ locale: "en" as "en" | "he" }));
vi.mock("./LanguageProvider", () => ({ useLanguage: () => ({
  locale: language.locale, dir: language.locale === "he" ? "rtl" : "ltr",
  t: (message: string, values?: Record<string, unknown>) => translate(language.locale as Locale, message, values),
}) }));
import { GameRoom } from "./GameRoom";
import { CapturedPiecesPanel } from "./CapturedPiecesPanel";
describe("per-player presentation", () => {
  it("renders each player's language independently while preserving chess glyphs", () => {
    language.locale = "he";
    const hebrew = renderToStaticMarkup(<GameRoom gameId="00000000-0000-4000-8000-000000000000" />);
    expect(hebrew).toContain('lang="he"');
    expect(hebrew).toContain('dir="rtl"');
    expect(hebrew).not.toContain("Setting up the board");
    const captures = renderToStaticMarkup(<CapturedPiecesPanel whiteCaptured={["p"]} blackCaptured={["r"]} />);
    expect(captures).toContain("כלים שנלקחו");
    expect(captures).not.toContain("${");
    expect(captures).not.toContain("White");
    language.locale = "en";
    expect(renderToStaticMarkup(<GameRoom gameId="00000000-0000-4000-8000-000000000000" />)).toContain("Setting up the board");
  });
});
