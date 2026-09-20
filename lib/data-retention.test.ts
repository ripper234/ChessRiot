import { describe, expect, it } from "vitest";
import { retentionCutoffs, TELEMETRY_RETENTION_DAYS } from "./data-retention";

describe("data retention", () => {
  it("uses an exact 30-day telemetry cutoff and an immediate archive cutoff", () => {
    const now = Date.parse("2026-08-03T12:34:56.000Z");
    expect(TELEMETRY_RETENTION_DAYS).toBe(30);
    expect(retentionCutoffs(now)).toEqual({
      telemetryBefore: "2026-07-04T12:34:56.000Z",
      pushDeliveryBefore: "2026-07-04T12:34:56.000Z",
      archiveExpiredBefore: "2026-08-03T12:34:56.000Z",
    });
  });
});
