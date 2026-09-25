import { afterEach, describe, expect, it, vi } from "vitest";
import { finishNotificationBoardTiming, readNotificationTap } from "./notification-open-timing";

const GAME_ID = "123e4567-e89b-42d3-a456-426614174000";
const PATH = `/__chessriot_notification_timing__/${GAME_ID}`;

function installCache(tap: unknown) {
  const entries = new Map<string, Response>();
  entries.set(PATH, new Response(JSON.stringify(tap)));
  const cache = {
    match: vi.fn(async (path: string) => entries.get(path)?.clone()),
    delete: vi.fn(async (path: string) => entries.delete(path)),
  };
  const open = vi.fn(async () => cache);
  vi.stubGlobal("caches", { open });
  return { open, cache, entries };
}

afterEach(() => vi.unstubAllGlobals());

describe("notification to board timing", () => {
  it("requires the notified version and consumes only its matching click", async () => {
    const clickedAt = 10_000;
    const { cache } = installCache({ clickedAt, gameVersion: 7, mode: "new-window" });
    expect(await readNotificationTap(GAME_ID, 6, 10_500)).toBeNull();
    expect(cache.delete).not.toHaveBeenCalled();
    const tap = await readNotificationTap(GAME_ID, 7, 10_500);
    expect(tap).toEqual({ clickedAt, gameVersion: 7, mode: "new-window" });
    expect(await finishNotificationBoardTiming(GAME_ID, tap!, 10_620)).toEqual({
      elapsedMs: 620, mode: "new-window",
    });
    expect(cache.delete).toHaveBeenCalledWith(PATH);
    expect(await readNotificationTap(GAME_ID, 7, 10_700)).toBeNull();
  });

  it("drops an expired receipt and never reports a stale board as the tap result", async () => {
    const { cache } = installCache({ clickedAt: 1, gameVersion: 2, mode: "same-game" });
    expect(await readNotificationTap(GAME_ID, 2, 120_002)).toBeNull();
    expect(cache.delete).toHaveBeenCalledWith(PATH);
  });

  it("does not consume a newer tap that arrives while a frame is painting", async () => {
    const { entries } = installCache({ clickedAt: 1_000, gameVersion: 2, mode: "same-game" });
    const first = await readNotificationTap(GAME_ID, 2, 1_100);
    entries.set(PATH, new Response(JSON.stringify({ clickedAt: 1_200, gameVersion: 2, mode: "existing-window" })));
    expect(await finishNotificationBoardTiming(GAME_ID, first!, 1_230)).toBeNull();
    expect(await readNotificationTap(GAME_ID, 2, 1_240)).toMatchObject({ clickedAt: 1_200 });
  });

  it("ignores malformed or unavailable storage without delaying navigation", async () => {
    installCache({ clickedAt: "100", gameVersion: 2, mode: "new-window", fen: "private" });
    expect(await readNotificationTap(GAME_ID, 2, 200)).toBeNull();
    vi.stubGlobal("caches", { open: async () => { throw new Error("storage unavailable"); } });
    expect(await readNotificationTap(GAME_ID, 2, 200)).toBeNull();
  });
});
