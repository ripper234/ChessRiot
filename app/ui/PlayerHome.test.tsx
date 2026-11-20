import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDashboardPanels, PlayerDashboard } from "./PlayerHome";

const gamesUrl = "/api/me/games?view=watch&limit=8";
const game = {
  id: "game-one", mode: "solo", status: "active", color: "w", turn: "w", updatedAt: "",
};
const social = { friends: [{ username: "Rook" }], incoming: [], outgoing: [] };
const referral = { inviteUrl: "/invite/abc", credits: 30, invitedPlayers: 3, creditsPerSignup: 10 };

function deferredResponse() {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  return { pending, finish };
}

function render(panels: ReturnType<typeof createDashboardPanels>) {
  return renderToStaticMarkup(<PlayerDashboard username="Player" initialPanels={panels} />);
}

afterEach(() => vi.unstubAllGlobals());

describe("player dashboard reads", () => {
  it("renders games while social reads are pending and recovers a failed panel independently", async () => {
    const friendsRequest = deferredResponse();
    const referralRequest = deferredResponse();
    const fetch = vi.fn((url: string) => {
      if (url === gamesUrl) return Promise.resolve(Response.json({ games: [game] }));
      if (url === "/api/me/friends") return friendsRequest.pending;
      if (url === "/api/me/referral") return referralRequest.pending;
      throw new Error("Unexpected dashboard request");
    });
    vi.stubGlobal("fetch", fetch);
    const panels = createDashboardPanels();
    const gamesRead = new Promise<void>((resolve) => panels.games.subscribe(resolve));
    const friendsRead = new Promise<void>((resolve) => panels.social.subscribe(resolve));
    const referralRead = new Promise<void>((resolve) => panels.referral.subscribe(resolve));
    panels.refresh();
    await gamesRead;

    const pending = render(panels);
    expect(pending).toContain('href="/g/game-one"');
    expect(pending).toContain("Loading your friends…");
    expect(pending).toContain("Loading your friend link…");
    expect(pending).not.toContain("Add a friend to challenge");
    expect(pending).not.toContain("<span>0</span>");

    friendsRequest.finish(Response.json({}, { status: 503 }));
    await friendsRead;
    const failed = render(panels);
    expect(failed).toContain("Could not refresh your friends.");
    expect(failed).toContain("Try again");
    expect(failed).not.toContain("Loading your friends…");
    expect(failed).toContain('href="/g/game-one"');

    fetch.mockResolvedValueOnce(Response.json({ friends: [], incoming: [], outgoing: [] }));
    await panels.social.refresh();
    const recovered = render(panels);
    expect(recovered).toContain("Add a friend to challenge");
    expect(recovered).toContain("<span>0</span>");
    expect(recovered).not.toContain("Try again");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([gamesUrl, "/api/me/friends", "/api/me/referral", "/api/me/friends"]);
    referralRequest.finish(Response.json(referral));
    await referralRead;
    expect(render(panels)).toContain('value="/invite/abc"');
  });

  it("shows unavailable data accurately and preserves known values through malformed or failed refreshes", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const panels = createDashboardPanels();
    const refreshAll = () => Promise.all([panels.games.refresh(), panels.social.refresh(), panels.referral.refresh()]);
    await refreshAll();
    const failed = render(panels);
    expect(failed.match(/Try again/g)).toHaveLength(3);
    expect(failed).not.toContain("No active games yet.");
    expect(failed).not.toContain("Add a friend to challenge");
    expect(failed).not.toContain("<span>0</span>");

    fetch.mockResolvedValueOnce(Response.json({ games: [game] }))
      .mockResolvedValueOnce(Response.json(social)).mockResolvedValueOnce(Response.json(referral));
    await refreshAll();
    fetch.mockResolvedValueOnce(Response.json({ games: [null] }))
      .mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await refreshAll();
    const stale = render(panels);
    expect(stale.match(/Try again/g)).toHaveLength(3);
    expect(stale).toContain('href="/g/game-one"');
    expect(stale).toContain("@Rook");
    expect(stale).toContain('value="/invite/abc"');
    expect(stale).toContain("<b>30</b>");

    fetch.mockResolvedValueOnce(Response.json({ games: [] }));
    await panels.games.refresh();
    expect(render(panels)).toContain("No active games yet.");
    expect(render(panels)).not.toContain("Could not refresh your games.");
  });

  it("ignores superseded and cancelled reads even when the network completes later", async () => {
    const old = deferredResponse();
    const cancelled = deferredResponse();
    const fetch = vi.fn().mockReturnValueOnce(old.pending)
      .mockResolvedValueOnce(Response.json({ games: [game] })).mockReturnValueOnce(cancelled.pending);
    vi.stubGlobal("fetch", fetch);
    const panel = createDashboardPanels().games;
    const listener = vi.fn();
    const unsubscribe = panel.subscribe(listener);
    const oldRead = panel.refresh();
    await panel.refresh();
    old.finish(Response.json({ games: [] }));
    await oldRead;
    const pending = panel.refresh();
    panel.cancel();
    cancelled.finish(Response.json({ games: [] }));
    await pending;

    expect(listener).toHaveBeenCalledTimes(1);
    expect(panel.getSnapshot()).toMatchObject({ data: [{ id: game.id }], error: false });
    unsubscribe();
  });
});
