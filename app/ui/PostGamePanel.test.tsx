import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { GameSnapshot } from "@/lib/game-types";
import { PostGamePanel } from "./PostGamePanel";

function completedGame(
  reason: "cancelled" | "stalemate",
  turnPaceDays: 1 | 3 | 5 = 3,
): GameSnapshot {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    mode: "multiplayer",
    variantId: "standard",
    aiDifficulty: null,
    turnPaceDays,
    status: "completed",
    version: 1,
    initialFen: "start",
    fen: "start",
    turn: "w",
    plyCount: 0,
    players: { white: { name: "Alice" }, black: { name: "Bob" } },
    you: { color: "w", name: "Alice" },
    check: false,
    claimableDraws: [],
    outcome: { winner: null, reason },
    elapsedMs: { w: 0, b: 0 },
    turnStartedAt: null,
    clockAsOf: "2026-08-03T00:00:00.000Z",
    moves: [],
    updatedAt: "2026-08-03T00:00:00.000Z",
  };
}

describe("PostGamePanel", () => {
  it("distinguishes a cancelled challenge from a played draw", () => {
    const cancelled = renderToStaticMarkup(
      <PostGamePanel game={completedGame("cancelled")} onDismiss={vi.fn()} onReview={vi.fn()} />,
    );
    const drawn = renderToStaticMarkup(
      <PostGamePanel game={completedGame("stalemate")} onDismiss={vi.fn()} onReview={vi.fn()} />,
    );

    expect(cancelled).toContain("Game cancelled");
    expect(cancelled).not.toContain("The game is a draw");
    expect(cancelled).toContain("pace=3");
    expect(cancelled).toContain("opponent=Bob");
    expect(drawn).toContain("The game is a draw");
    expect(drawn).toContain("Stalemate");
    expect(drawn).toContain("Share recap");
  });

  it.each([1, 3, 5] as const)("restores the %d-day pace for Play Again", (pace) => {
    const markup = renderToStaticMarkup(
      <PostGamePanel
        game={completedGame("stalemate", pace)}
        onDismiss={vi.fn()}
        onReview={vi.fn()}
      />,
    );

    expect(markup).toContain(`pace=${pace}`);
  });
});
