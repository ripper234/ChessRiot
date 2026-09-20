import { describe, expect, it } from "vitest";
import { consumeGameEntryNotice, waitingUiBecameStale } from "./game-room-entry";

describe("game entry one-shot state", () => {
  it("consumes a sent challenge and its opponent without dropping unrelated state", () => {
    expect(consumeGameEntryNotice(new URL(
      "https://chessriot.gg/g/game-id?challenge=sent&opponent=omri&keep=1#seat",
    ))).toEqual({
      notice: "challenge-sent",
      path: "/g/game-id?keep=1#seat",
    });
  });

  it("consumes a created invitation immediately", () => {
    expect(consumeGameEntryNotice(new URL(
      "https://chessriot.gg/g/game-id?invitation=created#invite",
    ))).toEqual({
      notice: "invitation-created",
      path: "/g/game-id#invite",
    });
  });

  it("clears waiting UI after an authoritative activation, including a fast first read", () => {
    expect(waitingUiBecameStale("waiting", "active", false)).toBe(true);
    expect(waitingUiBecameStale(null, "active", true)).toBe(true);
    expect(waitingUiBecameStale("waiting", "waiting", true)).toBe(false);
  });
});
