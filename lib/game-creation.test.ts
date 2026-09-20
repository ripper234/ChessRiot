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
      mode: "solo",
      variantId: "pawn-riot",
      difficulty: 3,
      turnPaceDays: 5,
      pending,
    })).toEqual({
      mode: "solo",
      variantId: "pawn-riot",
      difficulty: 3,
      ...pending,
    });
  });

  it("includes turn pace only for Multiplayer games", () => {
    expect(gameCreatePayload({
      mode: "multiplayer",
      variantId: "half-army",
      difficulty: 4,
      turnPaceDays: 5,
      opponentUsername: "Omri81",
      worldCode: "0xaf1234567890abcdef1234567890abcdef123456",
      pending,
    })).toEqual({
      mode: "multiplayer",
      variantId: "half-army",
      turnPaceDays: 5,
      opponentUsername: "Omri81",
      worldCode: "0xaf1234567890abcdef1234567890abcdef123456",
      ...pending,
    });
  });
});
