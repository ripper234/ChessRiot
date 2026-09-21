import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GameSnapshot } from "@/lib/game-types";
import { PendingInvitation } from "./PendingInvitation";

const game: GameSnapshot = {
  id: "pending-game", mode: "multiplayer", variantId: "standard", aiDifficulty: null,
  status: "waiting", version: 0, initialFen: "", fen: "", turn: "w", plyCount: 0,
  turnPaceDays: 3, players: { white: { name: "Creator" }, black: null },
  you: { color: "w", name: "Creator" }, check: false, claimableDraws: [], outcome: null,
  moves: [], elapsedMs: { w: 0, b: 0 }, turnStartedAt: null, clockAsOf: "", updatedAt: "", deadlineAt: null,
};
const render = (overrides: Partial<GameSnapshot> = {}, busy = false) => renderToStaticMarkup(
  <PendingInvitation game={{ ...game, ...overrides }} busy={busy} inviteUrl="/join/private" inviteShared={false} onCopy={() => {}} onPlay={() => {}} />,
);

describe("pending invitation", () => {
  it("offers leaving, copying and an optional opening without requiring simultaneous presence", () => {
    const html = render();
    expect(html).toContain('href="/"');
    for (const text of ["Back to games", "Copy invite link", "Play opening move", "do not need to be online together", "starts when your friend accepts"]) expect(html).toContain(text);
  });
  it("shows saved openings and direct challenges without a second opening or private-link action", () => {
    const html = render({ turn: "b", plyCount: 1, players: { white: { name: "Creator" }, black: { name: "Friend" } } });
    expect(html).toContain("Opening saved. You can leave now.");
    expect(html).toContain("@Friend");
    expect(html).not.toContain("Play opening move");
    expect(html).not.toContain("Copy invite link");
  });
  it("does not send someone away while the opening is still saving", () => {
    expect(render({}, true)).toContain("Saving…");
    expect(render({}, true)).not.toContain('href="/"');
    expect(render({ status: "active" })).toBe("");
    expect(render({ you: { color: "b", name: "Friend" } })).toBe("");
  });
});
