import { describe, expect, it } from "vitest";
import { gameCreatePayload, type PendingGameCreate } from "./game-creation";

const pending: PendingGameCreate = {
  playerToken: "player-token",
  inviteToken: "invite-token",
  requestId: "request-id",
};

describe("gameCreatePayload", () => {
  it("includes Riot Bot difficulty only for Solo games", () => {
    expect(gameCreatePayload({
      displayName: "Ron",
      guestToken: "guest-token",
      mode: "solo",
      variantId: "pawn-riot",
      difficulty: 3,
      turnPaceDays: 5,
      pending,
    })).toEqual({
      displayName: "Ron",
      guestToken: "guest-token",
      mode: "solo",
      variantId: "pawn-riot",
      difficulty: 3,
      ...pending,
    });
  });

  it("includes turn pace only for Multiplayer games", () => {
    expect(gameCreatePayload({
      displayName: "Ron",
      guestToken: "guest-token",
      mode: "multiplayer",
      variantId: "half-army",
      difficulty: 4,
      turnPaceDays: 5,
      pending,
    })).toEqual({
      displayName: "Ron",
      guestToken: "guest-token",
      mode: "multiplayer",
      variantId: "half-army",
      turnPaceDays: 5,
      ...pending,
    });
  });
});
