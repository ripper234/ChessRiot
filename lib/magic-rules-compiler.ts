import { getDatabase } from "@/db";
import {
  MAGIC_RULES_VERSION,
  magicRuleLabel,
  normalizeMagicPrompt,
  parseStoredMagicRules,
  serializeMagicRules,
  validateCompiledMagicRules,
} from "./magic-rules";
import {
  interpretMagicPrompt,
  MAGIC_COMPILER_VERSION,
  type MagicInterpretationFailureCode,
  type MagicInterpretationResult,
} from "./magic-rules-interpreter";

const COMPILATION_LEASE_MS = 20_000;
const CONTENDED_COMPILATION_WAIT_MS = 16_500;
const CONTENDED_COMPILATION_POLL_MS = 150;
const COMPILER_CIRCUIT_KEY = `magic-compiler-circuit:${MAGIC_COMPILER_VERSION}`;

interface CacheRow {
  compiler_version: string;
  status: "pending" | "compiled" | "ready";
  rules_json: string | null;
  lease_token: string | null;
  lease_until: number | null;
}

interface RejectionRow {
  compiler_version: string;
  code: "unsupported" | "ambiguous";
}

interface CompilerDependencies {
  db?: D1Database;
  interpret?: typeof interpretMagicPrompt;
  now?: () => number;
  randomUuid?: () => string;
}

export type MagicCompilationResult =
  | (Extract<MagicInterpretationResult, { ok: true }> & {
    cache: "hit" | "miss";
  })
  | ({
    ok: false;
    code:
      | MagicInterpretationFailureCode
      | "compiler_busy"
      | "compiler_circuit_open"
      | "compiler_storage_error";
    message: string;
    providerStatus?: number;
    retryAfterSeconds?: number;
    cache?: "hit" | "miss";
  });

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
}

export async function magicCompilationCacheKey(prompt: string): Promise<string> {
  return hex(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${MAGIC_COMPILER_VERSION}\n${prompt}`),
  ));
}

function cachedResult(
  prompt: string,
  row: CacheRow | null,
): Extract<MagicCompilationResult, { ok: true }> | null {
  if (row?.status !== "compiled" && row?.status !== "ready") return null;
  if (
    row.compiler_version !== MAGIC_COMPILER_VERSION
    || !row.rules_json
  ) throw new Error("Cached magic rules are invalid");
  const compiled = parseStoredMagicRules(row.rules_json);
  if (!compiled || compiled.version !== MAGIC_RULES_VERSION) {
    throw new Error("Cached magic rules are invalid");
  }
  return {
    ok: true,
    prompt,
    compiled,
    labels: compiled.rules.map((rule) => magicRuleLabel(rule)),
    cache: "hit",
  };
}

async function readCacheRow(
  db: D1Database,
  cacheKey: string,
): Promise<CacheRow | null> {
  return await db
    .prepare(`SELECT compiler_version, status, rules_json, lease_token, lease_until
      FROM magic_rule_compilations WHERE cache_key = ?`)
    .bind(cacheKey)
    .first<CacheRow>();
}

async function readCachedRejection(
  db: D1Database,
  cacheKey: string,
): Promise<Extract<MagicCompilationResult, { ok: false }> | null> {
  const row = await db.prepare(`SELECT compiler_version, code
    FROM magic_rule_rejections WHERE cache_key = ?`)
    .bind(cacheKey)
    .first<RejectionRow>();
  if (!row || row.compiler_version !== MAGIC_COMPILER_VERSION) return null;
  return {
    ok: false,
    code: row.code,
    message: row.code === "ambiguous"
      ? "That rule needs one more detail. Name the piece and the exact move count."
      : "That rule is not supported yet. Try extra moves or disable promotion, castling, or en passant.",
    cache: "hit",
  };
}

async function compilerCircuit(
  db: D1Database,
  nowMs: number,
): Promise<Extract<MagicCompilationResult, { ok: false }> | null> {
  const row = await db.prepare(`SELECT expires_at FROM rate_limit_windows
    WHERE key = ? AND expires_at > ?`)
    .bind(COMPILER_CIRCUIT_KEY, Math.floor(nowMs / 1_000))
    .first<{ expires_at: number }>();
  if (!row) return null;
  return {
    ok: false,
    code: "compiler_circuit_open",
    message: "Magic compilation is paused after an AI service failure. Try again later.",
    retryAfterSeconds: Math.max(1, row.expires_at - Math.floor(nowMs / 1_000)),
  };
}

function circuitDelaySeconds(
  failure: Extract<MagicInterpretationResult, { ok: false }>,
): number {
  if (
    failure.code === "provider_auth_error"
    || failure.code === "provider_permission_denied"
    || failure.code === "provider_rejected"
  ) {
    return 15 * 60;
  }
  if (failure.code === "compiler_unconfigured") return 5 * 60;
  return Math.max(30, Math.min(300, failure.retryAfterSeconds ?? 30));
}

async function tripCompilerCircuit(
  db: D1Database,
  failure: Extract<MagicInterpretationResult, { ok: false }>,
  nowMs: number,
): Promise<void> {
  if (failure.code === "unsupported" || failure.code === "ambiguous" || failure.code === "invalid_prompt") {
    return;
  }
  const nowSeconds = Math.floor(nowMs / 1_000);
  const expiresAt = nowSeconds + circuitDelaySeconds(failure);
  await db.prepare(`INSERT INTO rate_limit_windows (
      key, account_id, scope, window_start, hit_count, expires_at
    ) VALUES (?, 'system', 'magic_compiler_circuit', ?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      window_start = excluded.window_start,
      hit_count = rate_limit_windows.hit_count + 1,
      expires_at = MAX(rate_limit_windows.expires_at, excluded.expires_at)`)
    .bind(COMPILER_CIRCUIT_KEY, nowSeconds, expiresAt)
    .run();
}

async function clearCompilerCircuit(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM rate_limit_windows WHERE key = ?")
    .bind(COMPILER_CIRCUIT_KEY)
    .run();
}

async function waitForCachedCompilation(
  db: D1Database,
  cacheKey: string,
  prompt: string,
): Promise<MagicCompilationResult | null> {
  const deadline = Date.now() + CONTENDED_COMPILATION_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, CONTENDED_COMPILATION_POLL_MS);
    });
    const row = await readCacheRow(db, cacheKey);
    if (!row) return await readCachedRejection(db, cacheKey);
    if (row.status === "compiled" || row.status === "ready") {
      try {
        return cachedResult(prompt, row);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function compileMagicPromptCached(
  value: unknown,
  dependencies: CompilerDependencies = {},
): Promise<MagicCompilationResult> {
  const normalized = normalizeMagicPrompt(value);
  if (!normalized.ok) {
    return {
      ok: false as const,
      code: "invalid_prompt",
      message: normalized.message,
    };
  }

  const prompt = normalized.prompt;
  const db = dependencies.db ?? getDatabase();
  const cacheKey = await magicCompilationCacheKey(prompt);
  let existing = await readCacheRow(db, cacheKey);
  if (existing?.status === "compiled" || existing?.status === "ready") {
    try {
      return cachedResult(prompt, existing)!;
    } catch {
      await db
        .prepare(`DELETE FROM magic_rule_compilations
          WHERE cache_key = ? AND status IN ('compiled', 'ready')`)
        .bind(cacheKey)
        .run();
      existing = null;
    }
  }
  const rejected = await readCachedRejection(db, cacheKey);
  if (rejected) return rejected;

  const now = (dependencies.now ?? Date.now)();
  const circuit = await compilerCircuit(db, now);
  if (circuit) return circuit;
  const leaseToken = dependencies.randomUuid
    ? dependencies.randomUuid()
    : crypto.randomUUID();
  const acquired = await db
    .prepare(`INSERT INTO magic_rule_compilations (
      cache_key, compiler_version, status, rules_json,
      lease_token, lease_until, created_at, updated_at
    ) VALUES (?, ?, 'pending', NULL, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      compiler_version = excluded.compiler_version,
      status = 'pending',
      rules_json = NULL,
      lease_token = excluded.lease_token,
      lease_until = excluded.lease_until,
      updated_at = excluded.updated_at
    WHERE magic_rule_compilations.status = 'pending'
      AND magic_rule_compilations.lease_until <= ?
    RETURNING lease_token`)
    .bind(
      cacheKey,
      MAGIC_COMPILER_VERSION,
      leaseToken,
      now + COMPILATION_LEASE_MS,
      new Date(now).toISOString(),
      new Date(now).toISOString(),
      now,
    )
    .first<{ lease_token: string }>();

  if (acquired?.lease_token !== leaseToken) {
    existing = await readCacheRow(db, cacheKey);
    if (existing?.status === "compiled" || existing?.status === "ready") {
      try {
        return cachedResult(prompt, existing)!;
      } catch {
        // A later request may clear the corrupt row; fail closed here.
      }
    }
    const winner = await waitForCachedCompilation(db, cacheKey, prompt);
    if (winner) return winner;
    return {
      ok: false as const,
      code: "compiler_busy",
      message: "Magic is already interpreting that rule. Try again in a moment.",
      retryAfterSeconds: 1,
    };
  }

  const releaseFailure = async () => {
    await db
      .prepare(`DELETE FROM magic_rule_compilations
        WHERE cache_key = ? AND status = 'pending' AND lease_token = ?`)
      .bind(cacheKey, leaseToken)
      .run();
  };

  let interpreted: MagicInterpretationResult;
  try {
    interpreted = await (dependencies.interpret ?? interpretMagicPrompt)(prompt);
  } catch {
    await releaseFailure();
    const failure = {
      ok: false as const,
      code: "provider_network_error" as const,
      message: "Magic could not reach its AI service. Check again later.",
    };
    await tripCompilerCircuit(db, failure, (dependencies.now ?? Date.now)());
    return failure;
  }
  if (!interpreted.ok) {
    if (interpreted.code === "unsupported" || interpreted.code === "ambiguous") {
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO magic_rule_rejections (
            cache_key, compiler_version, code, created_at
          ) VALUES (?, ?, ?, ?)`)
          .bind(
            cacheKey,
            MAGIC_COMPILER_VERSION,
            interpreted.code,
            new Date((dependencies.now ?? Date.now)()).toISOString(),
          ),
        db.prepare(`DELETE FROM magic_rule_compilations
          WHERE cache_key = ? AND status = 'pending' AND lease_token = ?`)
          .bind(cacheKey, leaseToken),
      ]);
      await clearCompilerCircuit(db);
      return { ...interpreted, cache: "miss" };
    }
    await releaseFailure();
    await tripCompilerCircuit(db, interpreted, (dependencies.now ?? Date.now)());
    return interpreted;
  }
  let compiled;
  try {
    compiled = validateCompiledMagicRules(interpreted.compiled);
  } catch {
    await releaseFailure();
    const failure = {
      ok: false as const,
      code: "invalid_provider_response" as const,
      message: "Magic received an invalid compiler response. The team needs to inspect it.",
    };
    await tripCompilerCircuit(db, failure, (dependencies.now ?? Date.now)());
    return failure;
  }
  const rulesJson = serializeMagicRules(compiled);
  if (!rulesJson || compiled.version !== MAGIC_RULES_VERSION) {
    await releaseFailure();
    const failure = {
      ok: false as const,
      code: "invalid_provider_response" as const,
      message: "Magic received an invalid compiler response. The team needs to inspect it.",
    };
    await tripCompilerCircuit(db, failure, (dependencies.now ?? Date.now)());
    return failure;
  }
  const finishedAt = (dependencies.now ?? Date.now)();
  const stored = await db
    .prepare(`UPDATE magic_rule_compilations SET
      status = 'compiled', rules_json = ?, world_code = NULL,
      lease_token = NULL, lease_until = NULL,
      updated_at = ?
      WHERE cache_key = ? AND status = 'pending' AND lease_token = ?`)
    .bind(rulesJson, new Date(finishedAt).toISOString(), cacheKey, leaseToken)
    .run();
  if ((stored.meta.changes ?? 0) !== 1) {
    const winner = await readCacheRow(db, cacheKey);
    if (winner?.status === "compiled" || winner?.status === "ready") {
      return cachedResult(prompt, winner)!;
    }
    if (winner?.status === "pending") {
      return {
        ok: false,
        code: "compiler_busy",
        message: "Magic is already interpreting that rule. Try again in a moment.",
        retryAfterSeconds: 1,
      };
    }
    return {
      ok: false,
      code: "compiler_storage_error",
      message: "Magic could not safely save that rule. Try again.",
    };
  }
  await clearCompilerCircuit(db);
  return {
    ok: true,
    prompt,
    compiled,
    labels: compiled.rules.map((rule) => magicRuleLabel(rule)),
    cache: "miss",
  };
}
