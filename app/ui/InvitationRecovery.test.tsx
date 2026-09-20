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
  ])("declares English and an escape while the %s is loading", (_label, source) => {
    expect(source).toMatch(/lang="en" dir="ltr" translate="no"/);
    expect(source).toContain('<Brand locale="en" />');
    expect(source).toContain("Try again");
    expect(source).toContain("Back to home");
  });

  it("labels the personal referral as a friend link rather than a game invitation", () => {
    expect(referralSource).toContain("This adds a friend. It does not join an existing game.");
    expect(referralSource.match(/This adds a friend\. It does not join an existing game\./g)).toHaveLength(2);
  });

  it("renders English rule labels and isolates world identifiers in a game invitation", () => {
    expect(gameInviteSource).toContain('magicRuleLabel(rule, "en")');
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
