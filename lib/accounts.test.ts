import { describe, expect, it } from "vitest";
import { parseAccountGamesCursor } from "./accounts";

function cursor(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("account games cursor", () => {
  it("accepts a bounded updated-at and id pair", () => {
    expect(parseAccountGamesCursor(cursor({
      updatedAt: "2026-07-25T08:00:00.000Z",
      id: "9b163ce8-1fb0-4917-b761-4f7110b85035",
    }))).toEqual({
      updatedAt: "2026-07-25T08:00:00.000Z",
      id: "9b163ce8-1fb0-4917-b761-4f7110b85035",
    });
  });

  it("rejects malformed and structurally invalid cursors", () => {
    expect(parseAccountGamesCursor("not+base64")).toBeNull();
    expect(parseAccountGamesCursor(cursor({
      updatedAt: "yesterday",
      id: "9b163ce8-1fb0-4917-b761-4f7110b85035",
    }))).toBeNull();
    expect(parseAccountGamesCursor(cursor({
      updatedAt: "2026-07-25T08:00:00.000Z",
      id: "not-a-game",
    }))).toBeNull();
  });
});
