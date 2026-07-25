import { describe, expect, it } from "vitest";
import { requestIsSameOrigin } from "./validation";

function request(headers: HeadersInit = {}): Request {
  return new Request("https://chessriot.example/api/games", {
    method: "POST",
    headers,
  });
}

describe("same-origin request validation", () => {
  it("accepts ordinary same-origin and non-browser requests", () => {
    expect(requestIsSameOrigin(request())).toBe(true);
    expect(requestIsSameOrigin(request({
      origin: "https://chessriot.example",
    }))).toBe(true);
  });

  it.each([
    ["navigate", "document"],
    ["cors", "empty"],
    ["same-origin", "empty"],
    ["no-cors", "empty"],
  ])("accepts a sandboxed same-origin %s request", (mode, destination) => {
    expect(requestIsSameOrigin(request({
      origin: "null",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": mode,
      "sec-fetch-dest": destination,
    }))).toBe(true);
  });

  it("rejects opaque origins without trusted same-origin fetch metadata", () => {
    expect(requestIsSameOrigin(request({ origin: "null" }))).toBe(false);
    expect(requestIsSameOrigin(request({
      origin: "null",
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "cors",
    }))).toBe(false);
    for (const fetchSite of ["same-site", "none"]) {
      expect(requestIsSameOrigin(request({
        origin: "null",
        "sec-fetch-site": fetchSite,
      }))).toBe(false);
    }
  });

  it("rejects a different concrete origin", () => {
    expect(requestIsSameOrigin(request({
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
      "sec-fetch-mode": "cors",
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

  it("rejects browser requests whose Fetch Metadata is not same-origin", () => {
    for (const fetchSite of ["cross-site", "same-site", "none"]) {
      expect(requestIsSameOrigin(request({
        origin: "https://chessriot.example",
        "sec-fetch-site": fetchSite,
      }))).toBe(false);
      expect(requestIsSameOrigin(request({
        "sec-fetch-site": fetchSite,
      }))).toBe(false);
    }
  });
});
