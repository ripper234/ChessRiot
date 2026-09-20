import { Miniflare } from "miniflare";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compileMagicPromptCached,
  magicCompilationCacheKey,
} from "./magic-rules-compiler";
import type { MagicInterpretationResult } from "./magic-rules-interpreter";

const ready: MagicInterpretationResult = {
  ok: true,
  prompt: "Knights move 3 times",
  compiled: {
    version: 3,
    rules: [{
      kind: "move_sequence",
      pieces: ["n"],
      maxMoves: 3,
    }],
  },
  labels: ["Knights may move up to 3 times per turn; check ends the turn"],
};

const runtimes: Miniflare[] = [];

async function database(): Promise<D1Database> {
  const runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-05-22",
    d1Databases: { DB: "magic-cache-test" },
  });
  runtimes.push(runtime);
  const db = await runtime.getD1Database("DB");
  await db.prepare(`CREATE TABLE magic_rule_compilations (
    cache_key TEXT PRIMARY KEY NOT NULL,
    compiler_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'compiled', 'ready')),
    rules_json TEXT,
    world_code TEXT,
    lease_token TEXT,
    lease_until INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE magic_rule_rejections (
    cache_key TEXT PRIMARY KEY NOT NULL,
    compiler_version TEXT NOT NULL,
    code TEXT NOT NULL CHECK (code IN ('unsupported', 'ambiguous')),
    created_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE rate_limit_windows (
    key TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    hit_count INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`).run();
  return db;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  vi.restoreAllMocks();
});

describe("durable Magic compilation cache", () => {
  it("compiles one normalized prompt once and reuses validated D1 rules", async () => {
    const db = await database();
    const interpret = vi.fn(async () => ready);

    const first = await compileMagicPromptCached("  Knights   move 3 times  ", {
      db,
      interpret,
    });
    const second = await compileMagicPromptCached("Knights move 3 times", {
      db,
      interpret,
    });

    expect(first).toMatchObject({ ok: true, cache: "miss" });
    expect(second).toMatchObject({ ok: true, cache: "hit" });
    expect(interpret).toHaveBeenCalledTimes(1);
    const rows = await db
      .prepare("SELECT status, rules_json, lease_token FROM magic_rule_compilations")
      .all();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      status: "compiled",
      lease_token: null,
    });
  });

  it("uses a compiler-versioned digest rather than retaining the raw prompt", async () => {
    const key = await magicCompilationCacheKey("Knights move 3 times");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("Knights");
  });

  it("negatively caches semantic rejections but never provider failures", async () => {
    const db = await database();
    const unsupported = vi.fn(async (): Promise<MagicInterpretationResult> => ({
      ok: false,
      code: "unsupported",
      message: "Exploding queens are unsupported.",
    }));

    await expect(compileMagicPromptCached("Queens explode", {
      db,
      interpret: unsupported,
    })).resolves.toMatchObject({ ok: false, code: "unsupported" });
    await expect(compileMagicPromptCached("Queens explode", {
      db,
      interpret: unsupported,
    })).resolves.toMatchObject({ ok: false, code: "unsupported", cache: "hit" });
    expect(unsupported).toHaveBeenCalledTimes(1);
    expect((await db
      .prepare("SELECT COUNT(*) AS count FROM magic_rule_compilations")
      .first<{ count: number }>())?.count).toBe(0);

    const unavailable = vi.fn(async () => {
      throw new Error("provider down");
    });
    let now = 1_000;
    await expect(compileMagicPromptCached("Knights move twice", {
      db,
      interpret: unavailable,
      now: () => now,
    })).resolves.toMatchObject({ ok: false, code: "provider_network_error" });
    await expect(compileMagicPromptCached("Bishops move twice", {
      db,
      interpret: unavailable,
      now: () => now,
    })).resolves.toMatchObject({
      ok: false,
      code: "compiler_circuit_open",
      retryAfterSeconds: 30,
    });
    expect(unavailable).toHaveBeenCalledTimes(1);
    now += 30_000;
    await expect(compileMagicPromptCached("Bishops move twice", {
      db,
      interpret: unavailable,
      now: () => now,
    })).resolves.toMatchObject({ ok: false, code: "provider_network_error" });
    expect(unavailable).toHaveBeenCalledTimes(2);
    expect((await db
      .prepare("SELECT COUNT(*) AS count FROM magic_rule_compilations")
      .first<{ count: number }>())?.count).toBe(0);
  });

  it("distinguishes provider permission failures and pauses new compiler calls", async () => {
    const db = await database();
    const denied = vi.fn(async (): Promise<MagicInterpretationResult> => ({
      ok: false,
      code: "provider_permission_denied",
      message: "Compiler access is unavailable.",
      providerStatus: 403,
    }));

    await expect(compileMagicPromptCached("Knights move twice", {
      db,
      interpret: denied,
      now: () => 1_000,
    })).resolves.toMatchObject({
      ok: false,
      code: "provider_permission_denied",
      providerStatus: 403,
    });
    await expect(compileMagicPromptCached("Bishops move twice", {
      db,
      interpret: denied,
      now: () => 1_000,
    })).resolves.toMatchObject({
      ok: false,
      code: "compiler_circuit_open",
      retryAfterSeconds: 900,
    });
    expect(denied).toHaveBeenCalledTimes(1);
    expect((await db
      .prepare("SELECT COUNT(*) AS count FROM magic_rule_compilations")
      .first<{ count: number }>())?.count).toBe(0);
  });

  it("allows only one concurrent lease owner to call the provider", async () => {
    const db = await database();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const interpret = vi.fn(async () => {
      await gate;
      return ready;
    });

    const owner = compileMagicPromptCached("Knights move 3 times", {
      db,
      interpret,
    });
    await vi.waitFor(() => expect(interpret).toHaveBeenCalledTimes(1));
    const waiter = compileMagicPromptCached("Knights move 3 times", {
      db,
      interpret,
    });
    release();
    await expect(owner).resolves.toMatchObject({ ok: true, cache: "miss" });
    await expect(waiter).resolves.toMatchObject({ ok: true, cache: "hit" });
    expect(interpret).toHaveBeenCalledTimes(1);
  });

  it("does not make a superseded lease owner refund the active winner", async () => {
    const db = await database();
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const firstInterpret = vi.fn(async () => {
      await firstGate;
      return ready;
    });
    const secondInterpret = vi.fn(async () => {
      await secondGate;
      return ready;
    });

    const first = compileMagicPromptCached("Knights move 3 times", {
      db,
      interpret: firstInterpret,
      now: () => 1_000,
      randomUuid: () => "first-lease",
    });
    await vi.waitFor(() => expect(firstInterpret).toHaveBeenCalledTimes(1));
    const second = compileMagicPromptCached("Knights move 3 times", {
      db,
      interpret: secondInterpret,
      now: () => 21_001,
      randomUuid: () => "second-lease",
    });
    await vi.waitFor(() => expect(secondInterpret).toHaveBeenCalledTimes(1));

    releaseFirst();
    await expect(first).resolves.toMatchObject({
      ok: false,
      code: "compiler_busy",
      retryAfterSeconds: 1,
    });
    releaseSecond();
    await expect(second).resolves.toMatchObject({ ok: true, cache: "miss" });
  });
});
