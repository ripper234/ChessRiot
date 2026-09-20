import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const referralSource = readFileSync(
  new URL("./ReferralInvite.tsx", import.meta.url),
  "utf8",
);
const gameInviteSource = readFileSync(
  new URL("./JoinGame.tsx", import.meta.url),
  "utf8",
);

describe("invitation client recovery", () => {
  it.each([
    ["friend referral", referralSource],
    ["game invitation", gameInviteSource],
  ])("bounds and cancels every %s JSON request", (_label, source) => {
    expect(source).toContain("fetchJsonWithReadTimeout");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).toContain("new AbortController()");
    expect(source).toContain(".current?.abort()");
    expect(source).toMatch(/attempt\.current !== attemptId|loadAttempt\.current !== attemptId/);
  });

  it.each([
    ["friend referral", referralSource],
    ["game invitation", gameInviteSource],
  ])("declares native Hebrew and an escape while the %s is loading", (_label, source) => {
    expect(source).toMatch(/lang="he" dir="rtl" translate="no"/);
    expect(source).toContain('<Brand locale="he" />');
    expect(source).toContain("ניסיון נוסף");
    expect(source).toContain("חזרה לדף הבית");
  });

  it("labels the personal referral as a friend link rather than a game invitation", () => {
    expect(referralSource).toContain("זהו קישור להוספת חבר, לא הזמנה למשחק קיים.");
    expect(referralSource).toContain("זהו קישור לחברים, לא הזמנה למשחק קיים.");
  });

  it("renders Hebrew rule labels and isolates world identifiers in a game invitation", () => {
    expect(gameInviteSource).toContain('magicRuleLabel(rule, "he")');
    expect(gameInviteSource).toContain('<bdi dir="ltr">{invite.world.displayCode}</bdi>');
    expect(gameInviteSource).toContain('<PlayerHandle username={invite.world.creatorUsername} />');
    expect(gameInviteSource).not.toContain('invite.magicRules.labels.join');
  });

  it("recovers a response-lost game join through durable account membership", () => {
    expect(gameInviteSource).toContain("recoverJoinedGame");
    expect(gameInviteSource).toMatch(/response\.status === 409[\s\S]*invite_claimed[\s\S]*recoverJoinedGame/);
    expect(gameInviteSource).not.toContain("playerKey");
    expect(gameInviteSource).toMatch(
      /response\.status === 410 && data\.state === "claimed" && data\.gameId/,
    );
  });
});
