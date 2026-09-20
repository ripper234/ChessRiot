import { describe, expect, it } from "vitest";
import { turnTestRoundPassed, type TurnTestReceipt } from "./notification-turn-test-client";

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
