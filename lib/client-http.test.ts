import { describe, expect, it } from "vitest";
import { apiErrorMessage, requestHeaders } from "./client-http";

describe("client HTTP helpers", () => {
  it("uses a structured API error only when it is a string", () => {
    expect(apiErrorMessage({ error: { message: "Try again" } }, "Fallback"))
      .toBe("Try again");
    expect(apiErrorMessage({ error: { message: 503 } }, "Fallback"))
      .toBe("Fallback");
    expect(apiErrorMessage(null, "Fallback")).toBe("Fallback");
  });

  it("adds only the headers requested by the caller", () => {
    expect(requestHeaders(null)).toEqual({});
    expect(requestHeaders(null, true)).toEqual({
      "content-type": "application/json",
    });
    expect(requestHeaders("seat-token", true)).toEqual({
      "content-type": "application/json",
      authorization: "Bearer seat-token",
    });
  });
});
