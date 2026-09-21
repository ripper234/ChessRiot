import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ attempts: 0, updates: [] as Array<{ sql: string; args: unknown[] }>, notifications: [] as Array<{ gameVersion: number; targetColor: string; mutationNonce: string }> }));
const fixtures = vi.hoisted(() => ({
  game: () => ({ id: "game", game_mode: "multiplayer", status: state.attempts < 2 ? "waiting" : "active",
    version: state.attempts, turn_color: state.attempts ? "b" : "w", ply_count: state.attempts ? 1 : 0,
    joined_at: state.attempts < 2 ? null : new Date().toISOString(),
    black_name: "Black", black_token_hash: state.attempts < 2 ? null : "black-token", white_token_hash: "white-token" }),
}));

vi.mock("@/db", () => ({ ensureSchema: async () => {}, getDatabase: () => ({
  prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({
    sql, args, first: async () => sql.includes("SELECT account_id") ? { account_id: "white" } : null,
  }) }),
  batch: async (writes: Array<{ sql: string; args: unknown[] }>) => {
    state.updates.push(writes[0]);
    state.attempts += 1;
    return writes.map(() => ({ meta: { changes: state.attempts === 1 ? 0 : 1 } }));
  },
}) }));
vi.mock("@/lib/game-store", () => ({
  findGameByInviteHash: async () => fixtures.game(), findGameById: async () => fixtures.game(),
  accountPlayerColor: async () => state.attempts >= 2 ? "b" : null,
  playerColor: () => "b", readMoves: async () => [], snapshot: (game: unknown) => game,
}));
vi.mock("@/lib/accounts", () => ({ requireGoogleApiAccount: async () => ({ id: "black", username: "Black" }), enforceAccountRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/game-auth", () => ({ authorizeGameRequest: async () => ({ ok: true, color: "b", account: { id: "black", username: "Black" }, game: fixtures.game() }) }));
vi.mock("@/lib/validation", () => ({ hashSecret: async (s: string) => s, isSecret: () => true, isUuid: () => true, requestIsSameOrigin: () => true }));
vi.mock("@/lib/social", () => ({ accountsAreBlocked: async () => false }));
vi.mock("@/lib/push-notifications", () => ({ queueTurnNotifications: (_db: unknown, input: { gameVersion: number; targetColor: string; mutationNonce: string }) => { state.notifications.push(input); return []; } }));

import { POST as acceptLink } from "../app/api/invitations/[inviteToken]/join/route";
import { PATCH as answerChallenge } from "../app/api/games/[id]/challenge/route";

beforeEach(() => { state.attempts = 0; state.updates = []; state.notifications = []; });

describe("acceptance after an opening wins the write race", () => {
  it.each(["link", "challenge"])("retries %s with the new version and correct notification recipient", async (kind) => {
    const request = new Request("http://chessriot.test/accept", { method: kind === "link" ? "POST" : "PATCH",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ playerToken: "black-token", action: "accept", requestId: "request" }) });
    const response = kind === "link"
      ? await acceptLink(request, { params: Promise.resolve({ inviteToken: "invite" }) })
      : await answerChallenge(request, { params: Promise.resolve({ id: "game" }) });
    expect(response.status).toBe(200);
    expect(state.attempts).toBe(2);
    expect(await response.json()).toMatchObject({ game: { status: "active", version: 2, turn_color: "b", ply_count: 1 } });
    expect(state.updates[0].sql).toMatch(/AND version = \?/);
    const guardIndex = kind === "link" ? 8 : 5;
    expect(state.updates.map((write) => write.args[guardIndex])).toEqual([0, 1]);
    expect(state.notifications.map(({ gameVersion, targetColor }) => ({ gameVersion, targetColor })))
      .toEqual([{ gameVersion: 1, targetColor: "w" }, { gameVersion: 2, targetColor: "b" }]);
    expect(state.notifications[0].mutationNonce).not.toBe(state.notifications[1].mutationNonce);
  });
});
