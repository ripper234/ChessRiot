import { describe, expect, it } from "vitest";
import { notificationTestFlow } from "./notification-turn-test-flow";
import type { TurnTestReceipt } from "./notification-turn-test-client";

const opened: TurnTestReceipt = { receivedAt: 10, shownAt: 11, clickedAt: 20, openedAt: 21, visibleClients: 0, windowClients: 0 };
const confirmed = { ...opened, confirmedAt: 22 };
const base = { version: 0, pendingReply: false, completed: false, expired: false, deviceEnabled: true, receipts: {} };

describe("guided notification test", () => {
  it("guides all four rounds without advancing on delivery or opening alone", () => {
    const receipts: Record<number, TurnTestReceipt> = {};
    for (let round = 1; round <= 4; round++) {
      expect(notificationTestFlow({ ...base, version: (round - 1) * 2, receipts })).toMatchObject({ phase: "ready", round });
      expect(notificationTestFlow({ ...base, version: round * 2 - 1, pendingReply: true, receipts }).phase).toBe("waiting");
      receipts[round * 2] = { receivedAt: 10, shownAt: 11, visibleClients: 0 };
      expect(notificationTestFlow({ ...base, version: round * 2, receipts }).phase).toBe("waiting");
      receipts[round * 2] = { ...opened };
      expect(notificationTestFlow({ ...base, version: round * 2, receipts }).phase).toBe("confirm");
      receipts[round * 2] = { ...confirmed };
    }
    expect(notificationTestFlow({ ...base, version: 8, receipts })).toMatchObject({ phase: "complete", passed: 4 });
  });

  it("offers a restart for immutable failed evidence", () => {
    for (const receipt of [
      { ...opened, visibleClients: 1 },
      { ...opened, visibleClients: null },
      { ...opened, showRejectedAt: 12 },
      { ...opened, receivedAt: 30 },
    ]) {
      expect(notificationTestFlow({ ...base, version: 2, receipts: { 2: receipt } }).phase).toBe("blocked");
    }
  });

  it("requires a known enabled device and preserves stop, expiry and device recovery", () => {
    expect(notificationTestFlow({ ...base, deviceEnabled: undefined }).phase).toBe("checking");
    for (const change of [{ expired: true }, { completed: true }, { deviceEnabled: false }, { deviceIssue: "Wrong phone" }]) {
      expect(notificationTestFlow({ ...base, ...change }).phase).toBe("blocked");
    }
  });

  it("never offers a fifth move or skips missing prior evidence", () => {
    expect(notificationTestFlow({ ...base, version: 8, receipts: { 8: confirmed } }).phase).toBe("blocked");
    expect(notificationTestFlow({ ...base, version: 4, receipts: { 4: confirmed } }).phase).toBe("blocked");
    expect(notificationTestFlow({ ...base, version: 8, receipts: { 2: confirmed, 4: confirmed, 6: confirmed, 8: opened } }).phase).toBe("confirm");
  });

  it("offers recovery immediately when earlier evidence disappears, even during delivery or confirmation", () => {
    const cases: Record<number, TurnTestReceipt>[] = [{}, { 4: opened }];
    for (const receipts of cases) {
      expect(notificationTestFlow({ ...base, version: 4, receipts })).toMatchObject({ phase: "blocked", reason: expect.stringContaining("earlier round") });
    }
    expect(notificationTestFlow({ ...base, version: 3, pendingReply: true }).phase).toBe("blocked");
    expect(notificationTestFlow({ ...base, version: 1, pendingReply: true, deliveryFailed: true }))
      .toMatchObject({ phase: "blocked", reason: expect.stringContaining("could not be delivered") });
  });

  it("preserves actual phone evidence when provider bookkeeping reports failure", () => {
    expect(notificationTestFlow({ ...base, version: 2, deliveryFailed: true, receipts: { 2: opened } }).phase).toBe("confirm");
    expect(notificationTestFlow({ ...base, version: 2, deliveryFailed: true, receipts: { 2: confirmed } }).phase).toBe("ready");
  });

  it("waits after a committed move even when the game snapshot is catching up", () => {
    expect(notificationTestFlow({ ...base, version: 1, pendingReply: true }).phase).toBe("waiting");
  });
});
