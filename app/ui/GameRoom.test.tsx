import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameRoom } from "./GameRoom";

const gameRoomSource = readFileSync(new URL("./GameRoom.tsx", import.meta.url), "utf8");

describe("GameRoom protected first paint", () => {
  it("renders native Hebrew immediately with an escape from loading", () => {
    const html = renderToStaticMarkup(<GameRoom gameId="00000000-0000-4000-8000-000000000000" />);

    expect(html).toContain('lang="he"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('translate="no"');
    expect(html).toContain("מסדרים את הלוח");
    expect(html).toContain("שחמט אמיתי. משחק מלא.");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("ASSEMBLING BOARD");
    expect(html).not.toContain("REAL CHESS. TOTAL PLAY.");
  });

  it("pins chess ordering LTR while restoring Hebrew direction inside content", () => {
    expect(gameRoomSource).toContain('<section className="game-layout" dir="ltr">');
    expect(gameRoomSource).toMatch(/className="board-column"\s*dir="rtl"/);
    expect(gameRoomSource).toContain('<div className="match-banner" dir="ltr">');
    expect(gameRoomSource).toMatch(/className=\{`player-card white-player[^\n]+dir="ltr"/);
    expect(gameRoomSource).toMatch(/className="player-card-copy" dir="rtl"/);
    expect(gameRoomSource).toContain('<div className="promotion-card"><p>הכתר את החייל</p><div dir="ltr">');
  });

  it("passes Hebrew locale to every protected visual and isolates directional notation", () => {
    expect(gameRoomSource).toContain('<Brand locale="he" />');
    expect(gameRoomSource).toContain('<ResignationFinisher color={game.you.color} locale="he" />');
    expect(gameRoomSource).toContain('<CheckmateFinisher finisher={finisher} locale="he" />');
    expect(gameRoomSource).toMatch(/<BoardActionAnimation[\s\S]*?locale="he"/);
    expect(gameRoomSource).toContain('magicRuleLabel(rule, "he")');
    expect(gameRoomSource).toMatch(/part\.dir === "ltr"[\s\S]*?<bdi dir="ltr"/);
  });
});
