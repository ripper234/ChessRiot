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
  type MagicInterpretationResult,
} from "./magic-rules-interpreter";

const COMPILATION_LEASE_MS = 20_000;

interface CacheRow {
  compiler_version: string;
  status: "pending" | "ready";
  rules_json: string | null;
  lease_token: string | null;
  lease_until: number | null;
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
  | Extract<MagicInterpretationResult, { ok: false }>;

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
  if (row?.status !== "ready") return null;
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
    labels: compiled.rules.map(magicRuleLabel),
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

export async function compileMagicPromptCached(
  value: unknown,
  dependencies: CompilerDependencies = {},
): Promise<MagicCompilationResult> {
  const normalized = normalizeMagicPrompt(value);
  if (!normalized.ok) {
    return {
      ok: false,
      code: "invalid_prompt",
      message: normalized.message,
    };
  }

  const prompt = normalized.prompt;
  const db = dependencies.db ?? getDatabase();
  const cacheKey = await magicCompilationCacheKey(prompt);
  let existing = await readCacheRow(db, cacheKey);
  if (existing?.status === "ready") {
    try {
      return cachedResult(prompt, existing)!;
    } catch {
      await db
        .prepare("DELETE FROM magic_rule_compilations WHERE cache_key = ? AND status = 'ready'")
        .bind(cacheKey)
        .run();
      existing = null;
    }
  }

  const now = (dependencies.now ?? Date.now)();
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
    if (existing?.status === "ready") {
      try {
        return cachedResult(prompt, existing)!;
      } catch {
        // A later request may clear the corrupt row; fail closed here.
      }
    }
    return {
      ok: false,
      code: "unavailable",
      message: "Magic is already interpreting that rule. Try again in a moment.",
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
    return {
      ok: false,
      code: "unavailable",
      message: "Magic could not interpret that rule right now. Try again.",
    };
  }
  if (!interpreted.ok) {
    await releaseFailure();
    return interpreted;
  }

  let compiled;
  try {
    compiled = validateCompiledMagicRules(interpreted.compiled);
  } catch {
    await releaseFailure();
    return {
      ok: false,
      code: "unavailable",
      message: "Magic could not safely validate that rule. Try rephrasing it.",
    };
  }
  const rulesJson = serializeMagicRules(compiled);
  if (!rulesJson || compiled.version !== MAGIC_RULES_VERSION) {
    await releaseFailure();
    return {
      ok: false,
      code: "unavailable",
      message: "Magic could not safely validate that rule. Try rephrasing it.",
    };
  }
  const finishedAt = (dependencies.now ?? Date.now)();
  const stored = await db
    .prepare(`UPDATE magic_rule_compilations SET
      status = 'ready', rules_json = ?, lease_token = NULL, lease_until = NULL,
      updated_at = ?
      WHERE cache_key = ? AND status = 'pending' AND lease_token = ?`)
    .bind(rulesJson, new Date(finishedAt).toISOString(), cacheKey, leaseToken)
    .run();
  if ((stored.meta.changes ?? 0) !== 1) {
    const winner = await readCacheRow(db, cacheKey);
    if (winner?.status === "ready") return cachedResult(prompt, winner)!;
    return {
      ok: false,
      code: "unavailable",
      message: "Magic could not safely save that rule. Try again.",
    };
  }
  return {
    ok: true,
    prompt,
    compiled,
    labels: compiled.rules.map(magicRuleLabel),
    cache: "miss",
  };
}
