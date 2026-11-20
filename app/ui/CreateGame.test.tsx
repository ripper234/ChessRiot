import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CreateGame, isStoredOpponentUsername, matchesCreatedOpponent, resolveChallengeRecipient } from "./CreateGame";

describe("Magic game recovery opponent usernames", () => {
  it("accepts complete international handles instead of counting UTF-16 units", () => {
    expect(isStoredOpponentUsername("א\u05B0".repeat(20))).toBe(true);
    expect(isStoredOpponentUsername("𐐀𐐁𐐂")).toBe(true);
    expect(isStoredOpponentUsername("棋手88")).toBe(true);
  });

  it("accepts the empty solo-game value and rejects malformed stored handles", () => {
    expect(isStoredOpponentUsername("")).toBe(true);
    expect(isStoredOpponentUsername("knight 81")).toBe(false);
    expect(isStoredOpponentUsername("פרש\u202E81")).toBe(false);
  });
});

const navigation = vi.hoisted(() => ({ query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(navigation.query),
}));
vi.mock("./AccountGate", () => ({ useAccountSession: () => ({
  username: "Sender", features: { magicRules: false }, featureRequests: { magicRules: null },
}) }));

describe("named challenge setup", () => {
  it.each(["opponent=שלום", "mode=multiplayer&opponent=שלום"])('shows the recipient before effects run for %s', (query) => {
    navigation.query = query;
    const html = renderToStaticMarkup(<CreateGame />);
    expect(html).toContain('<bdi dir="auto">@שלום</bdi>');
    expect(html).toMatch(/<option[^>]*value="שלום"[^>]*selected=""/);
    expect(html).toMatch(/type="submit" disabled=""/);
    expect(html).toContain("Checking your friends list");
    expect(html).not.toContain("CREATE &amp; SHARE INVITATION");
  });

  it("keeps an ordinary link invitation available while friends load", () => {
    navigation.query = "mode=multiplayer";
    const html = renderToStaticMarkup(<CreateGame />);
    expect(html).toContain("CREATE &amp; SHARE INVITATION");
    expect(html).not.toMatch(/type="submit" disabled/);
  });

  it("retains the named target through delay, failure and absence, and verifies the account handle on retry", () => {
    const selected = "STRASSE";
    const unresolved: Parameters<typeof resolveChallengeRecipient>[1][] = [
      { status: "loading" }, { status: "failed" }, { status: "ready", usernames: ["Other"] },
    ];
    for (const list of unresolved) {
      const result = resolveChallengeRecipient(selected, list);
      expect(result.username).toBe(selected);
      expect(result.blockedMessage).toBeTruthy();
    }
    expect(resolveChallengeRecipient(selected, { status: "ready", usernames: ["Straße"] }))
      .toEqual({ username: "Straße", blockedMessage: "" });
  });

  it("keeps the player's revised choice when a delayed friends response arrives", () => {
    const loaded = { status: "ready" as const, usernames: ["First", "Second"] };
    expect(resolveChallengeRecipient("", { status: "failed" }).blockedMessage).toBe("");
    expect(resolveChallengeRecipient("", loaded)).toEqual({ username: "", blockedMessage: "" });
    expect(resolveChallengeRecipient("Second", loaded)).toEqual({ username: "Second", blockedMessage: "" });
  });

  it("only opens a replay for the same mode and recipient", () => {
    const game = { mode: "multiplayer" as const, players: { white: { name: "Sender" }, black: { name: "Friend" } } };
    const linkGame = { ...game, players: { ...game.players, black: null } };
    expect(matchesCreatedOpponent("multiplayer", "Friend", game)).toBe(true);
    expect(matchesCreatedOpponent("multiplayer", "Other", game)).toBe(false);
    expect(matchesCreatedOpponent("multiplayer", "", game, "/invite")).toBe(false);
    expect(matchesCreatedOpponent("multiplayer", "Friend", linkGame, "/invite")).toBe(false);
    expect(matchesCreatedOpponent("multiplayer", "", linkGame, "/invite")).toBe(true);
    expect(matchesCreatedOpponent("solo", "", linkGame)).toBe(false);
  });
});
