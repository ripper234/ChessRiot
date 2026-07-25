import { describe, expect, it } from "vitest";
import { requestIsSameOrigin } from "./validation";

const TARGET = "https://chessriot.example/api/games";

function request(headers: Record<string, string> = {}): Request {
  return new Request(TARGET, { method: "POST", headers });
}

describe("same-origin request validation", () => {
  it("accepts the exact origin and rejects origin mismatches", () => {
    expect(requestIsSameOrigin(request({
      origin: "https://chessriot.example",
    }))).toBe(true);
    expect(requestIsSameOrigin(request({
      origin: "https://chessriot.example",
      "sec-fetch-site": "same-origin",
    }))).toBe(true);
    expect(requestIsSameOrigin(request({
      origin: "https://evil.example",
      "sec-fetch-site": "same-origin",
    }))).toBe(false);
    expect(requestIsSameOrigin(request({
      origin: "http://chessriot.example",
      "sec-fetch-site": "same-origin",
    }))).toBe(false);
    expect(requestIsSameOrigin(request({
      origin: "https://chessriot.example:444",
      "sec-fetch-site": "same-origin",
    }))).toBe(false);
  });

  it.each(["navigate", "cors", "same-origin", "no-cors"])(
    "accepts a sandboxed opaque origin with browser same-origin provenance in %s mode",
    (mode) => {
      expect(requestIsSameOrigin(request({
        origin: "null",
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": mode,
      }))).toBe(true);
    },
  );

  it("rejects opaque origins without same-origin browser provenance", () => {
    expect(requestIsSameOrigin(request({ origin: "null" }))).toBe(false);
    for (const fetchSite of ["same-site", "cross-site", "none"]) {
      expect(requestIsSameOrigin(request({
        origin: "null",
        "sec-fetch-site": fetchSite,
      }))).toBe(false);
    }
  });

  it("keeps metadata-free server calls while rejecting non-same-origin browser metadata", () => {
    expect(requestIsSameOrigin(request())).toBe(true);
    expect(requestIsSameOrigin(request({
      "sec-fetch-site": "same-origin",
    }))).toBe(true);
    for (const fetchSite of ["same-site", "cross-site", "none"]) {
      expect(requestIsSameOrigin(request({
        "sec-fetch-site": fetchSite,
      }))).toBe(false);
      expect(requestIsSameOrigin(request({
        origin: "https://chessriot.example",
        "sec-fetch-site": fetchSite,
      }))).toBe(false);
    }
  });
});
