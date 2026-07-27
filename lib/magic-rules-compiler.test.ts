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
    status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
    rules_json TEXT,
    lease_token TEXT,
    lease_until INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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
      status: "ready",
      lease_token: null,
    });
  });

  it("uses a compiler-versioned digest rather than retaining the raw prompt", async () => {
    const key = await magicCompilationCacheKey("Knights move 3 times");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("Knights");
  });

  it("never caches unsupported or provider-failure results", async () => {
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
    expect((await db
      .prepare("SELECT COUNT(*) AS count FROM magic_rule_compilations")
      .first<{ count: number }>())?.count).toBe(0);

    const unavailable = vi.fn(async () => {
      throw new Error("provider down");
    });
    await expect(compileMagicPromptCached("Knights move twice", {
      db,
      interpret: unavailable,
    })).resolves.toMatchObject({ ok: false, code: "unavailable" });
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
    const waiter = await compileMagicPromptCached("Knights move 3 times", {
      db,
      interpret,
    });
    expect(waiter).toMatchObject({ ok: false, code: "unavailable" });
    release();
    await expect(owner).resolves.toMatchObject({ ok: true, cache: "miss" });
    expect(interpret).toHaveBeenCalledTimes(1);
  });
});
