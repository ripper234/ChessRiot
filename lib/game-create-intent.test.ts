import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireGameCreateIntent,
  gameCreateFingerprint,
  releaseGameCreateIntent,
  type GameCreateFingerprintInput,
} from "./game-create-intent";

const runtimes: Miniflare[] = [];

async function database(): Promise<D1Database> {
  const runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: crypto.randomUUID() },
  });
  runtimes.push(runtime);
  const db = await runtime.getD1Database("DB");
  await db.prepare(`CREATE TABLE games (
    id TEXT PRIMARY KEY NOT NULL,
    create_request_id TEXT NOT NULL UNIQUE
  )`).run();
  await db.prepare(`CREATE TABLE game_create_intents (
    request_id TEXT PRIMARY KEY NOT NULL,
    fingerprint TEXT NOT NULL,
    lease_token TEXT NOT NULL,
    lease_until INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  return db;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

describe("durable game-create intents", () => {
  it("hashes every canonical idempotency field without retaining request data", async () => {
    const base = {
      accountId: "account",
      displayName: "Ron",
      playerHash: "player-hash",
      inviteHash: "invite-hash",
      mode: "multiplayer" as const,
      difficulty: null,
      turnPaceDays: 3 as const,
      magicPrompt: "Knights move 3 times",
    };
    const fingerprint = await gameCreateFingerprint(base);

    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toContain("Knights");
    const variants: GameCreateFingerprintInput[] = [
      { ...base, accountId: "other-account" },
      { ...base, displayName: "Omri" },
      { ...base, playerHash: "other-player-hash" },
      { ...base, inviteHash: "other-invite-hash" },
      {
        ...base,
        mode: "solo",
        difficulty: 3,
        turnPaceDays: null,
      },
      { ...base, turnPaceDays: 5 },
      { ...base, magicPrompt: "Rooks move 2 times" },
    ];
    for (const variant of variants) {
      await expect(gameCreateFingerprint(variant)).resolves.not.toBe(fingerprint);
    }
  });

  it("rejects conflicts and identical in-flight retries without replacing the owner", async () => {
    const db = await database();
    const first = await acquireGameCreateIntent(db, "request", "fingerprint-a", {
      now: () => 1_000,
      randomUuid: () => "owner-a",
    });
    expect(first).toEqual({ status: "acquired", leaseToken: "owner-a" });

    await expect(acquireGameCreateIntent(db, "request", "fingerprint-a", {
      now: () => 2_000,
      randomUuid: () => "owner-b",
    })).resolves.toEqual({ status: "pending", retryAfter: 29 });
    await expect(acquireGameCreateIntent(db, "request", "fingerprint-b", {
      now: () => 2_000,
      randomUuid: () => "owner-c",
    })).resolves.toEqual({ status: "conflict" });

    await expect(db
      .prepare(`SELECT fingerprint, lease_token FROM game_create_intents
        WHERE request_id = 'request'`)
      .first()).resolves.toMatchObject({
      fingerprint: "fingerprint-a",
      lease_token: "owner-a",
    });
  });

  it("reclaims only an expired matching intent and releases only the current owner", async () => {
    const db = await database();
    await acquireGameCreateIntent(db, "request", "fingerprint", {
      now: () => 1_000,
      randomUuid: () => "owner-a",
    });

    expect(await releaseGameCreateIntent(
      db,
      "request",
      "fingerprint",
      "not-the-owner",
    )).toBe(false);
    await db
      .prepare("UPDATE game_create_intents SET lease_until = 1_999 WHERE request_id = ?")
      .bind("request")
      .run();

    await expect(acquireGameCreateIntent(db, "request", "fingerprint", {
      now: () => 2_000,
      randomUuid: () => "owner-b",
    })).resolves.toEqual({ status: "acquired", leaseToken: "owner-b" });
    expect(await releaseGameCreateIntent(
      db,
      "request",
      "fingerprint",
      "owner-a",
    )).toBe(false);
    expect(await releaseGameCreateIntent(
      db,
      "request",
      "fingerprint",
      "owner-b",
    )).toBe(true);
    expect(await db
      .prepare("SELECT COUNT(*) AS count FROM game_create_intents")
      .first<{ count: number }>()).toEqual({ count: 0 });
  });

  it("does not create a new intent after the completed game row exists", async () => {
    const db = await database();
    await db
      .prepare("INSERT INTO games (id, create_request_id) VALUES (?, ?)")
      .bind("game", "request")
      .run();

    await expect(acquireGameCreateIntent(db, "request", "fingerprint", {
      now: () => 1_000,
      randomUuid: () => "owner",
    })).resolves.toEqual({ status: "completed" });
    expect(await db
      .prepare("SELECT COUNT(*) AS count FROM game_create_intents")
      .first<{ count: number }>()).toEqual({ count: 0 });
  });
});
