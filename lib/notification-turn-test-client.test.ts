import { afterEach, describe, expect, it, vi } from "vitest";
import { clearEndedTurnTestNotification, turnTestRoundPassed, type TurnTestReceipt } from "./notification-turn-test-client";

afterEach(() => vi.unstubAllGlobals());

describe("one-phone end-to-end notification evidence", () => {
  const complete: TurnTestReceipt = {
    receivedAt: 10, shownAt: 11, clickedAt: 20, openedAt: 21, confirmedAt: 22, visibleClients: 0,
  };
  it("requires all delivery, click, exact-game opening and physical confirmation stages", () => {
    expect(turnTestRoundPassed(complete)).toBe(true);
    for (const key of ["receivedAt", "shownAt", "clickedAt", "openedAt", "confirmedAt"] as const) {
      expect(turnTestRoundPassed({ ...complete, [key]: undefined })).toBe(false);
    }
    expect(turnTestRoundPassed(undefined)).toBe(false);
    expect(turnTestRoundPassed({ ...complete, showRejectedAt: 10 })).toBe(false);
    expect(turnTestRoundPassed({ ...complete, receivedAt: 100 })).toBe(false);
    expect(turnTestRoundPassed({ receivedAt: 1, shownAt: 2 })).toBe(false);
  });
  it("never certifies a foreground or unknown-visibility receipt as a closed-app test", () => {
    for (const visibleClients of [1, 2, null, undefined]) {
      expect(turnTestRoundPassed({ ...complete, visibleClients })).toBe(false);
    }
  });
});

describe("leaving an ended notification test", () => {
  it("targets the current active worker when this page still has an older controller", async () => {
    const active = { postMessage: vi.fn() };
    const controller = { postMessage: vi.fn() };
    vi.stubGlobal("navigator", { serviceWorker: { controller, getRegistration: async () => ({ active }) } });
    await clearEndedTurnTestNotification({ id: "test-game", status: "completed", version: 5 });
    expect(active.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "clear-turn-notification", gameId: "test-game", gameVersion: 5 });
    expect(controller.postMessage).not.toHaveBeenCalled();
  });

  it("falls back to the controller when registration lookup fails", async () => {
    const controller = { postMessage: vi.fn() };
    vi.stubGlobal("navigator", { serviceWorker: { controller, getRegistration: async () => { throw new Error("unavailable"); } } });
    await clearEndedTurnTestNotification({ id: "test-game", status: "completed", version: 5 });
    expect(controller.postMessage).toHaveBeenCalledOnce();
  });
  it.each([true, false])("sends its completed version before navigation, with a controller: %s", async (controlled) => {
    const postMessage = vi.fn();
    const worker = { postMessage };
    vi.stubGlobal("navigator", { serviceWorker: {
      controller: controlled ? worker : null,
      getRegistration: async () => ({ active: worker }),
    } });
    await clearEndedTurnTestNotification({ id: "test-game", status: "active", version: 4 });
    expect(postMessage).not.toHaveBeenCalled();
    await clearEndedTurnTestNotification({ id: "test-game", status: "completed", version: 5 });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      type: "clear-turn-notification", gameId: "test-game", gameVersion: 5,
    });
  });

  it("does not block leaving an ended test when notification cleanup is unavailable", async () => {
    const game = { id: "test-game", status: "completed" as const, version: 5 };
    vi.stubGlobal("navigator", {});
    await expect(clearEndedTurnTestNotification(game)).resolves.toBeUndefined();
    vi.stubGlobal("navigator", { serviceWorker: { controller: null, getRegistration: async () => { throw new Error("unavailable"); } } });
    await expect(clearEndedTurnTestNotification(game)).resolves.toBeUndefined();
  });
});
