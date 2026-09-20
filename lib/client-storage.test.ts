import { describe, expect, it } from "vitest";
import {
  gamePathWithInvitation,
  hasSeatTokenInHash,
  privateGamePath,
  privateGameUrl,
  readInvitationUrlFromHash,
  readSeatTokenFromHash,
  removeInvitationFromHash,
} from "./client-storage";

const PLAYER_TOKEN = "a".repeat(43);

describe("portable private game links", () => {
  it("round-trips a valid seat token in the URL fragment", () => {
    const path = privateGamePath("game-123", PLAYER_TOKEN);

    expect(path).toBe(`/g/game-123#seat=${PLAYER_TOKEN}`);
    expect(hasSeatTokenInHash(new URL(path, "https://play.example").hash)).toBe(true);
    expect(readSeatTokenFromHash(new URL(path, "https://play.example").hash)).toBe(PLAYER_TOKEN);
  });

  it("builds an absolute private link without placing the token in the HTTP URL", () => {
    const url = new URL(privateGameUrl("game-123", PLAYER_TOKEN, "https://play.example"));

    expect(url.origin + url.pathname + url.search).toBe("https://play.example/g/game-123");
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#seat=${PLAYER_TOKEN}`);
  });

  it("encodes the game id and rejects invalid secrets", () => {
    expect(privateGamePath("family game", PLAYER_TOKEN)).toBe(`/g/family%20game#seat=${PLAYER_TOKEN}`);
    expect(() => privateGamePath("game-123", "too-short")).toThrow("Invalid player token");
  });

  it("rejects missing, malformed, short, and query-only seat tokens", () => {
    expect(readSeatTokenFromHash("")).toBeNull();
    expect(readSeatTokenFromHash("#seat=short")).toBeNull();
    expect(readSeatTokenFromHash("#seat=***")).toBeNull();
    expect(readSeatTokenFromHash(`?seat=${PLAYER_TOKEN}`)).toBeNull();
    expect(hasSeatTokenInHash("#seat=short")).toBe(true);
  });
});

describe("transient invitation recovery", () => {
  const invite = `https://play.example/join/${"b".repeat(43)}`;

  it("carries a newly-created invitation in a fragment and validates its origin", () => {
    const path = gamePathWithInvitation("game-123", invite);
    const hash = new URL(path, "https://play.example").hash;

    expect(new URL(path, "https://play.example").search).toBe("");
    expect(readInvitationUrlFromHash(hash, "https://play.example")).toBe(invite);
    expect(readInvitationUrlFromHash(hash, "https://other.example")).toBeNull();
  });

  it("rejects malformed invitation URLs and removes only their fragment field", () => {
    expect(readInvitationUrlFromHash("#invite=not-a-url", "https://play.example")).toBeNull();
    expect(readInvitationUrlFromHash(
      `#invite=${encodeURIComponent(`https://evil.example/join/${"b".repeat(43)}`)}`,
      "https://play.example",
    )).toBeNull();
    expect(removeInvitationFromHash("#seat=abc&invite=private")).toBe("#seat=abc");
    expect(removeInvitationFromHash("#invite=private")).toBe("");
  });
});
