import { describe, expect, it } from "vitest";
import { sanitizeObservedRoute } from "./observability";

describe("observability route privacy", () => {
  it("removes personal referral codes from recorded routes", () => {
    expect(sanitizeObservedRoute("/api/referrals/Abcd1234_Efgh567/claim"))
      .toBe("/api/referrals/:code/claim");
  });
});
