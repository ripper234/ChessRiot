import { describe, expect, it } from "vitest";
import { createRequestTiming, observedRequestTimings } from "./request-timing";

describe("request stage timing", () => {
  it("records only numeric stages in the response and observer metadata", async () => {
    const timing = createRequestTiming();
    expect(await timing.measure("schema", async () => "ready")).toBe("ready");
    expect(timing.measureSync("snapshot", () => 42)).toBe(42);
    const response = timing.apply(new Response("ok"));
    expect(response.headers.get("server-timing"))
      .toMatch(/^schema;dur=\d+, snapshot;dur=\d+$/);
    expect(observedRequestTimings(response)).toEqual({
      schemaMs: expect.any(Number),
      snapshotMs: expect.any(Number),
    });
  });

  it("ignores unknown, malformed, and unbounded metadata", () => {
    const response = new Response(null, { headers: {
      "server-timing": "schema;dur=48, private;dur=3, moves;dur=120001, cookie;desc=secret;dur=5, authorize;dur=7",
    } });
    expect(observedRequestTimings(response)).toEqual({ schemaMs: 48, authorizeMs: 7 });
  });

  it("preserves the measured operation's error", async () => {
    const timing = createRequestTiming();
    await expect(timing.measure("upsert", async () => {
      throw new Error("database unavailable");
    })).rejects.toThrow("database unavailable");
    expect(observedRequestTimings(timing.apply(new Response(null))))
      .toEqual({ upsertMs: expect.any(Number) });
  });
});
