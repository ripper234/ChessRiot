import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { activityDetail, activityItems } from "./ActivityInbox";
import { createDashboardPanels, PlayerDashboard } from "./PlayerHome";
import { recapShareTitle } from "./PostGamePanel";

describe("incoming opening visibility", () => {
  it.each([false, true])("shows the current opening state in the dashboard before accepting: %s", async (played) => {
    const panels = createDashboardPanels();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ games: [{
      id: "challenge", mode: "multiplayer", variantId: "standard", status: "waiting",
      color: "b", opponent: "שלום", turn: played ? "b" : "w", turnPaceDays: 3,
      isMagic: false, updatedAt: "", outcome: null,
    }] })));
    try {
      await panels.games.refresh();
    } finally {
      vi.unstubAllGlobals();
    }
    const html = renderToStaticMarkup(<PlayerDashboard username="Black" initialPanels={panels} />);
    expect(html).toContain(played ? "White has played the opening" : "White moves first");
    expect(html).toContain("ACCEPT AS BLACK");
    expect(html).toContain('<bdi dir="auto">@שלום</bdi>');
    expect(html).not.toContain("Challenge received");
  });

  it.each([false, true])("preserves opening and pace information through activity parsing and rendering: %s", (openingPlayed) => {
    const [item] = activityItems([{ id: "challenge", kind: "challenge", title: "New challenge",
      detail: "server fallback", createdAt: "2026-09-21T00:00:00Z", username: "שלום",
      gameId: "game", openingPlayed, turnPaceDays: 3 }]);
    const html = renderToStaticMarkup(<p>{activityDetail(item)}</p>);
    expect(html).toContain(openingPlayed ? "White has played the opening" : "White moves first");
    expect(html).toContain("3 days per move");
    expect(html).toContain('<bdi dir="auto">@שלום</bdi>');
  });

  it("isolates both player names in the system share title", () => {
    expect(recapShareTitle({ players: { white: { name: "שלום-123" }, black: { name: "Alex" } } }))
      .toBe("\u2068שלום-123\u2069 vs \u2068Alex\u2069 on ChessRiot");
  });
});
