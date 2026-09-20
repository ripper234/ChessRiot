import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GameRoom } from "./GameRoom";

const gameRoomSource = readFileSync(new URL("./GameRoom.tsx", import.meta.url), "utf8");

describe("GameRoom protected first paint", () => {
  it("renders English immediately with an escape from loading", () => {
    const html = renderToStaticMarkup(<GameRoom gameId="00000000-0000-4000-8000-000000000000" />);

    expect(html).toContain('lang="en"');
    expect(html).toContain('dir="ltr"');
    expect(html).toContain('translate="no"');
    expect(html).toContain("Setting up the board");
    expect(html).toContain("REAL CHESS. TOTAL PLAY.");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("ASSEMBLING BOARD");
    expect(html).not.toContain("שחמט אמיתי. משחק מלא.");
  });

  it("keeps chess ordering and English content LTR", () => {
    expect(gameRoomSource).toContain('<section className="game-layout" dir="ltr">');
    expect(gameRoomSource).toMatch(/className="board-column"\s*dir="ltr"/);
    expect(gameRoomSource).toContain('<div className="match-banner" dir="ltr">');
    expect(gameRoomSource).toMatch(/className=\{`player-card white-player[^\n]+dir="ltr"/);
    expect(gameRoomSource).toMatch(/className="player-card-copy" dir="ltr"/);
    expect(gameRoomSource).toContain('<div className="promotion-card"><p>Promote your pawn</p><div dir="ltr">');
  });

  it("passes English locale to every protected visual and isolates directional notation", () => {
    expect(gameRoomSource).toContain('<Brand locale="en" />');
    expect(gameRoomSource).toContain('<ResignationFinisher color={game.you.color} locale="en" />');
    expect(gameRoomSource).toContain('<CheckmateFinisher finisher={finisher} locale="en" />');
    expect(gameRoomSource).toMatch(/<BoardActionAnimation[\s\S]*?locale="en"/);
    expect(gameRoomSource).toContain('magicRuleLabel(rule, "en")');
    expect(gameRoomSource).toMatch(/part\.dir === "ltr"[\s\S]*?<bdi dir="ltr"/);
  });
});
