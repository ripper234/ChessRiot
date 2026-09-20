import { ensureSchema, getDatabase } from "@/db";
import {
  creditBalance,
  MAGIC_GAME_CREDIT_COST,
  WORLD_ROYALTY_GAMES_PER_CREDIT,
} from "./credits";
import {
  displayMagicWorldCode,
  isMagicWorldCode,
  magicWorldIdentity,
} from "./magic-world-code";
import {
  compileMagicPromptCached,
  magicCompilationCacheKey,
  type MagicCompilationResult,
} from "./magic-rules-compiler";
import { MAGIC_COMPILER_VERSION } from "./magic-rules-interpreter";
import {
  magicRuleLabel,
  normalizeMagicPrompt,
  parseStoredMagicRules,
  serializeMagicRules,
  type CompiledMagicRules,
} from "./magic-rules";

export interface MagicWorldSummary {
  code: string;
  displayCode: string;
  rules: CompiledMagicRules;
  labels: string[];
  creatorUsername: string | null;
  createdAt: string;
  gamesPlayed: number;
}

export interface MagicWorldDetail extends MagicWorldSummary {
  parents: string[];
  children: string[];
}

export interface MagicWorldMap {
  nodes: MagicWorldSummary[];
  edges: Array<{ parentCode: string; childCode: string }>;
}

interface WorldRow {
  code: string;
  rules_json: string;
  creator_username: string | null;
  created_at: string;
  games_played: number;
}

interface EntitlementRow {
  account_id: string;
  world_code: string;
  request_fingerprint: string | null;
  consumed_at: string | null;
  game_id: string | null;
}

interface MagicDebitRow {
  id: string;
  account_id: string;
  amount: number;
  reason: string;
  source_key: string;
  world_code: string | null;
}

interface NormalizedApplyRequest {
  selectedCode: string | null;
  prompt: string | null;
  parentCode: string | null;
  fingerprint: string;
}

export type ApplyMagicWorldResult =
  | {
      ok: true;
      world: MagicWorldSummary;
      created: boolean;
      creditBalance: number;
      creditCost: typeof MAGIC_GAME_CREDIT_COST;
      gameCreateRequestId: string;
    }
  | {
      ok: false;
      code:
        | "invalid"
        | "not_found"
        | "insufficient_credits"
        | "idempotency_conflict"
        | "lineage_conflict"
        | "in_progress"
        | "compile_failed";
      message: string;
      compilation?: Extract<MagicCompilationResult, { ok: false }>;
    };

function worldFromRow(row: WorldRow): MagicWorldSummary {
  const rules = parseStoredMagicRules(row.rules_json);
  if (!rules) throw new Error("Stored World rules are invalid");
  return {
    code: row.code,
    displayCode: displayMagicWorldCode(row.code),
    rules,
    labels: rules.rules.map((rule) => magicRuleLabel(rule)),
    creatorUsername: row.creator_username,
    createdAt: row.created_at,
    gamesPlayed: Number(row.games_played ?? 0),
  };
}

const WORLD_SELECT = `SELECT worlds.code, worlds.rules_json,
    creators.username AS creator_username,
    worlds.created_at,
    COUNT(DISTINCT CASE WHEN uses.human_played_at IS NOT NULL THEN uses.game_id END) AS games_played
  FROM magic_worlds AS worlds
  LEFT JOIN accounts AS creators ON creators.id = worlds.creator_account_id
  LEFT JOIN magic_world_uses AS uses ON uses.world_code = worlds.code`;

export async function getMagicWorld(code: string): Promise<MagicWorldDetail | null> {
  if (!isMagicWorldCode(code)) return null;
  await ensureSchema();
  const database = getDatabase();
  const row = await database
    .prepare(`${WORLD_SELECT}
      WHERE worlds.code = ?
      GROUP BY worlds.code, worlds.rules_json, creators.username, worlds.created_at`)
    .bind(code)
    .first<WorldRow>();
  if (!row) return null;
  const [parents, children] = await Promise.all([
    database
      .prepare(`SELECT parent_code AS code FROM magic_world_derivations
        WHERE child_code = ? ORDER BY created_at ASC, parent_code ASC`)
      .bind(code)
      .all<{ code: string }>(),
    database
      .prepare(`SELECT child_code AS code FROM magic_world_derivations
        WHERE parent_code = ? ORDER BY created_at ASC, child_code ASC`)
      .bind(code)
      .all<{ code: string }>(),
  ]);
  return {
    ...worldFromRow(row),
    parents: (parents.results ?? []).map((entry) => entry.code),
    children: (children.results ?? []).map((entry) => entry.code),
  };
}

export async function pendingMagicWorldReservation(accountId: string): Promise<{
  gameCreateRequestId: string;
  world: MagicWorldSummary;
  creditBalance: number;
} | null> {
  await ensureSchema();
  const entitlement = await getDatabase().prepare(`SELECT game_create_request_id, world_code
    FROM magic_world_entitlements
    WHERE account_id = ? AND consumed_at IS NULL AND game_id IS NULL
    ORDER BY created_at ASC, game_create_request_id ASC
    LIMIT 1`)
    .bind(accountId)
    .first<{ game_create_request_id: string; world_code: string }>();
  if (!entitlement) return null;
  const world = await getMagicWorld(entitlement.world_code);
  if (!world) throw new Error("Reserved World is missing");
  return {
    gameCreateRequestId: entitlement.game_create_request_id,
    world,
    creditBalance: await creditBalance(accountId),
  };
}

export async function listMagicWorlds(
  accountId: string,
  scope: "popular" | "new" | "mine" = "popular",
  limit = 50,
): Promise<MagicWorldSummary[]> {
  await ensureSchema();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const mineClause = scope === "mine" ? "WHERE worlds.creator_account_id = ?" : "";
  const order = scope === "new"
    ? "worlds.created_at DESC"
    : "games_played DESC, worlds.created_at DESC";
  const statement = getDatabase().prepare(`${WORLD_SELECT}
    ${mineClause}
    GROUP BY worlds.code, worlds.rules_json, creators.username, worlds.created_at
    ORDER BY ${order}
    LIMIT ?`);
  const result = scope === "mine"
    ? await statement.bind(accountId, safeLimit).all<WorldRow>()
    : await statement.bind(safeLimit).all<WorldRow>();
  return (result.results ?? []).map(worldFromRow);
}

export async function getMagicWorldMap(accountId: string): Promise<MagicWorldMap> {
  const nodes = await listMagicWorlds(accountId, "popular", 30);
  const included = new Set(nodes.map((world) => world.code));
  const edges = await getDatabase()
    .prepare(`SELECT parent_code, child_code FROM magic_world_derivations
      ORDER BY created_at DESC LIMIT 500`)
    .all<{ parent_code: string; child_code: string }>();
  return {
    nodes,
    edges: (edges.results ?? [])
      .filter((edge) => included.has(edge.parent_code) && included.has(edge.child_code))
      .map((edge) => ({
        parentCode: edge.parent_code,
        childCode: edge.child_code,
      })),
  };
}

async function entitlementFor(requestId: string): Promise<EntitlementRow | null> {
  return await getDatabase()
    .prepare(`SELECT account_id, world_code, request_fingerprint, consumed_at, game_id
      FROM magic_world_entitlements WHERE game_create_request_id = ?`)
    .bind(requestId)
    .first<EntitlementRow>();
}

async function databaseWorldIdentity(code: string): Promise<{
  full_hash: string;
  canonical_code: string;
  creator_account_id: string | null;
} | null> {
  return await getDatabase()
    .prepare("SELECT full_hash, canonical_code, creator_account_id FROM magic_worlds WHERE code = ?")
    .bind(code)
    .first<{ full_hash: string; canonical_code: string; creator_account_id: string | null }>();
}

async function sha256Hex(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function magicDebitSource(gameCreateRequestId: string): string {
  return `magic:${gameCreateRequestId}`;
}

function magicDebitId(gameCreateRequestId: string, fingerprint: string): string {
  return `${magicDebitSource(gameCreateRequestId)}:${fingerprint}`;
}

function magicRefundSource(gameCreateRequestId: string): string {
  return `magic-refund:${gameCreateRequestId}`;
}

async function debitForSource(sourceKey: string): Promise<MagicDebitRow | null> {
  return await getDatabase().prepare(`SELECT id, account_id, amount, reason, source_key, world_code
    FROM account_credit_ledger WHERE source_key = ?`)
    .bind(sourceKey)
    .first<MagicDebitRow>();
}

async function refundMagicDebit(input: {
  accountId: string;
  gameCreateRequestId: string;
  fingerprint: string;
  worldCode?: string | null;
  createdAt: string;
}): Promise<void> {
  const debitSource = magicDebitSource(input.gameCreateRequestId);
  const debitId = magicDebitId(input.gameCreateRequestId, input.fingerprint);
  const refundSource = magicRefundSource(input.gameCreateRequestId);
  await getDatabase().prepare(`INSERT OR IGNORE INTO account_credit_ledger (
      id, account_id, amount, reason, source_key, world_code, created_at
    ) SELECT ?, ?, ?, 'magic_refund', ?, COALESCE(?, debit.world_code), ?
      FROM account_credit_ledger AS debit
      WHERE debit.id = ?
        AND debit.source_key = ?
        AND debit.account_id = ?
        AND debit.amount = ?
        AND debit.reason = 'magic_spend'`)
    .bind(
      refundSource,
      input.accountId,
      MAGIC_GAME_CREDIT_COST,
      refundSource,
      input.worldCode ?? null,
      input.createdAt,
      debitId,
      debitSource,
      input.accountId,
      -MAGIC_GAME_CREDIT_COST,
    )
    .run();
}

async function normalizeApplyRequest(input: {
  prompt?: unknown;
  worldCode?: unknown;
  parentCode?: unknown;
}): Promise<{ ok: true; value: NormalizedApplyRequest } | { ok: false; message: string }> {
  const selectedCode = isMagicWorldCode(input.worldCode) ? input.worldCode : null;
  if (input.worldCode !== undefined && input.worldCode !== null && input.worldCode !== "" && !selectedCode) {
    return { ok: false, message: "That World code is invalid." };
  }
  const promptResult = input.prompt === undefined || input.prompt === null || input.prompt === ""
    ? null
    : normalizeMagicPrompt(input.prompt);
  if (promptResult && !promptResult.ok) return { ok: false, message: promptResult.message };
  const prompt = promptResult?.ok ? promptResult.prompt : null;
  if ((selectedCode ? 1 : 0) + (prompt ? 1 : 0) !== 1) {
    return { ok: false, message: "Describe one Magic rule or select one existing World." };
  }
  const parentCode = input.parentCode === undefined || input.parentCode === null || input.parentCode === ""
    ? null
    : isMagicWorldCode(input.parentCode) ? input.parentCode : "invalid";
  if (parentCode === "invalid") {
    return { ok: false, message: "The parent World code is invalid." };
  }
  if (selectedCode && parentCode) {
    return { ok: false, message: "Fork a World by describing the complete inherited rules." };
  }
  const fingerprint = await sha256Hex(JSON.stringify({
    version: 1,
    worldCode: selectedCode,
    prompt,
    parentCode,
  }));
  return { ok: true, value: { selectedCode, prompt, parentCode, fingerprint } };
}

async function replayAppliedMagicWorld(input: {
  accountId: string;
  gameCreateRequestId: string;
  prompt?: unknown;
  worldCode?: unknown;
  parentCode?: unknown;
}): Promise<ApplyMagicWorldResult | null> {
  const entitlement = await entitlementFor(input.gameCreateRequestId);
  if (!entitlement) return null;
  const normalized = await normalizeApplyRequest(input);
  if (
    entitlement.account_id !== input.accountId
    || !normalized.ok
    || entitlement.request_fingerprint !== normalized.value.fingerprint
  ) {
    return {
      ok: false,
      code: "idempotency_conflict",
      message: "This Apply Magic request was already used with different settings.",
    };
  }
  const world = await getMagicWorld(entitlement.world_code);
  if (!world) throw new Error("Applied World is missing");
  return {
    ok: true,
    world,
    created: false,
    creditBalance: await creditBalance(input.accountId),
    creditCost: MAGIC_GAME_CREDIT_COST,
    gameCreateRequestId: input.gameCreateRequestId,
  };
}

export async function replayMagicWorldApply(input: {
  accountId: string;
  gameCreateRequestId: string;
  prompt?: unknown;
  worldCode?: unknown;
  parentCode?: unknown;
}): Promise<ApplyMagicWorldResult | null> {
  await ensureSchema();
  return replayAppliedMagicWorld(input);
}

export async function pendingMagicWorldApplyMatches(input: {
  accountId: string;
  gameCreateRequestId: string;
  prompt?: unknown;
  worldCode?: unknown;
  parentCode?: unknown;
}): Promise<boolean> {
  await ensureSchema();
  if (await entitlementFor(input.gameCreateRequestId)) return false;
  const normalized = await normalizeApplyRequest(input);
  if (!normalized.ok) return false;
  const debitSource = magicDebitSource(input.gameCreateRequestId);
  const debit = await debitForSource(debitSource);
  if (
    !debit
    || debit.id !== magicDebitId(input.gameCreateRequestId, normalized.value.fingerprint)
    || debit.account_id !== input.accountId
    || debit.amount !== -MAGIC_GAME_CREDIT_COST
    || debit.reason !== "magic_spend"
  ) return false;
  const refund = await getDatabase().prepare(`SELECT 1 AS found
    FROM account_credit_ledger
    WHERE source_key = ? AND account_id = ? AND reason = 'magic_refund'`)
    .bind(magicRefundSource(input.gameCreateRequestId), input.accountId)
    .first<{ found: number }>();
  return refund?.found !== 1;
}

export async function magicPromptNeedsCompilation(prompt: unknown): Promise<boolean> {
  const normalized = normalizeMagicPrompt(prompt);
  if (!normalized.ok) return false;
  await ensureSchema();
  const cacheKey = await magicCompilationCacheKey(normalized.prompt);
  const ready = await getDatabase()
    .prepare(`SELECT 1 AS ready
      WHERE EXISTS (
        SELECT 1 FROM magic_rule_compilations
        WHERE cache_key = ? AND status IN ('compiled', 'ready')
      ) OR EXISTS (
        SELECT 1 FROM magic_rule_rejections
        WHERE cache_key = ? AND compiler_version = ?
      )`)
    .bind(cacheKey, cacheKey, MAGIC_COMPILER_VERSION)
    .first<{ ready: number }>();
  return ready?.ready !== 1;
}

async function derivationWouldCycle(parentCode: string, childCode: string): Promise<boolean> {
  const row = await getDatabase().prepare(`WITH RECURSIVE descendants(code) AS (
      SELECT ?
      UNION
      SELECT derivations.child_code
      FROM magic_world_derivations AS derivations
      JOIN descendants ON descendants.code = derivations.parent_code
    )
    SELECT 1 AS found FROM descendants WHERE code = ? LIMIT 1`)
    .bind(childCode, parentCode)
    .first<{ found: number }>();
  return row?.found === 1;
}

export async function applyMagicWorld(input: {
  accountId: string;
  gameCreateRequestId: string;
  prompt?: unknown;
  worldCode?: unknown;
  parentCode?: unknown;
}): Promise<ApplyMagicWorldResult> {
  await ensureSchema();
  const replay = await replayAppliedMagicWorld(input);
  if (replay) return replay;
  const normalized = await normalizeApplyRequest(input);
  if (!normalized.ok) return { ok: false, code: "invalid", message: normalized.message };
  const { selectedCode, prompt, parentCode, fingerprint } = normalized.value;
  const database = getDatabase();
  const now = new Date().toISOString();
  const debitSource = magicDebitSource(input.gameCreateRequestId);
  const debitRecordId = magicDebitId(input.gameCreateRequestId, fingerprint);
  const refundSource = magicRefundSource(input.gameCreateRequestId);

  let existingWorld: MagicWorldDetail | null = null;
  if (selectedCode) {
    existingWorld = await getMagicWorld(selectedCode);
    if (!existingWorld) {
      return { ok: false, code: "not_found", message: "That World does not exist." };
    }
  }
  if (parentCode && !(await getMagicWorld(parentCode))) {
    return { ok: false, code: "not_found", message: "The parent World does not exist." };
  }

  const existingDebit = await debitForSource(debitSource);
  const refunded = await database.prepare(`SELECT 1 AS found FROM account_credit_ledger
    WHERE source_key = ? AND account_id = ? AND reason = 'magic_refund'`)
    .bind(refundSource, input.accountId)
    .first<{ found: number }>();
  if (
    refunded?.found === 1
    || (existingDebit && (
      existingDebit.id !== debitRecordId
      || existingDebit.account_id !== input.accountId
      || existingDebit.amount !== -MAGIC_GAME_CREDIT_COST
      || existingDebit.reason !== "magic_spend"
    ))
  ) {
    return {
      ok: false,
      code: "idempotency_conflict",
      message: refunded?.found === 1
        ? "That Apply Magic request was refunded. Start a new Apply request."
        : "This Apply Magic request was already used with different settings.",
    };
  }

  // Reserve the credit before any provider call. The fingerprinted debit ID
  // binds this request ID to exactly one normalized Apply payload.
  await creditBalance(input.accountId);
  if (!existingDebit) {
    await database.prepare(`INSERT OR IGNORE INTO account_credit_ledger (
      id, account_id, amount, reason, source_key, world_code, created_at
    ) SELECT ?, ?, ?, 'magic_spend', ?, NULL, ?
      WHERE (SELECT COALESCE(SUM(amount), 0) FROM account_credit_ledger
        WHERE account_id = ?) >= ?`)
      .bind(
        debitRecordId,
        input.accountId,
        -MAGIC_GAME_CREDIT_COST,
        debitSource,
        now,
        input.accountId,
        MAGIC_GAME_CREDIT_COST,
      )
      .run();
  }
  const settledDebit = await debitForSource(debitSource);
  if (
    !settledDebit
    || settledDebit.id !== debitRecordId
    || settledDebit.account_id !== input.accountId
    || settledDebit.amount !== -MAGIC_GAME_CREDIT_COST
    || settledDebit.reason !== "magic_spend"
  ) {
    return {
      ok: false,
      code: settledDebit ? "idempotency_conflict" : "insufficient_credits",
      message: settledDebit
        ? "This Apply Magic request was already used with different settings."
        : "You need 1 credit to Apply Magic.",
    };
  }

  let compiled: CompiledMagicRules;
  let promptHash: string | null = null;
  let compilationCacheKey: string | null = null;
  if (existingWorld) {
    compiled = existingWorld.rules;
  } else {
    let compilation: MagicCompilationResult;
    try {
      compilation = await compileMagicPromptCached(prompt);
    } catch (error) {
      await refundMagicDebit({
        accountId: input.accountId,
        gameCreateRequestId: input.gameCreateRequestId,
        fingerprint,
        createdAt: now,
      });
      throw error;
    }
    if (!compilation.ok) {
      if (compilation.code === "compiler_busy") {
        return {
          ok: false,
          code: "in_progress",
          message: "Magic is still interpreting this rule. Retry the same Apply request in a moment.",
          compilation,
        };
      }
      await refundMagicDebit({
        accountId: input.accountId,
        gameCreateRequestId: input.gameCreateRequestId,
        fingerprint,
        createdAt: now,
      });
      return {
        ok: false,
        code: "compile_failed",
        message: `${compilation.message} Your credit was restored.`,
        compilation,
      };
    }
    compiled = compilation.compiled;
    compilationCacheKey = await magicCompilationCacheKey(compilation.prompt);
    promptHash = compilationCacheKey;
  }

  let identity: Awaited<ReturnType<typeof magicWorldIdentity>>;
  let rulesJson: string;
  try {
    identity = await magicWorldIdentity(compiled);
    const serialized = serializeMagicRules(identity.rules);
    if (!serialized) throw new Error("Canonical World rules could not be serialized");
    rulesJson = serialized;
  } catch (error) {
    await refundMagicDebit({
      accountId: input.accountId,
      gameCreateRequestId: input.gameCreateRequestId,
      fingerprint,
      createdAt: now,
    });
    throw error;
  }
  if (
    parentCode
    && parentCode !== identity.code
    && await derivationWouldCycle(parentCode, identity.code)
  ) {
    await refundMagicDebit({
      accountId: input.accountId,
      gameCreateRequestId: input.gameCreateRequestId,
      fingerprint,
      worldCode: identity.code,
      createdAt: now,
    });
    return {
      ok: false,
      code: "lineage_conflict",
      message: "That fork would create a cycle in the World map. Your credit was restored.",
    };
  }
  const matchingCode = await databaseWorldIdentity(identity.code);
  if (
    matchingCode
    && (
      matchingCode.full_hash !== identity.fullHash
      || matchingCode.canonical_code !== identity.canonicalCode
    )
  ) {
    await refundMagicDebit({
      accountId: input.accountId,
      gameCreateRequestId: input.gameCreateRequestId,
      fingerprint,
      worldCode: identity.code,
      createdAt: now,
    });
    throw new Error("Magic World hash collision detected");
  }
  const sourceKey = `world-source:${input.gameCreateRequestId}`;
  const kind = parentCode && parentCode !== identity.code
    ? "fork"
    : existingWorld || selectedCode ? "play" : matchingCode ? "rediscover" : "create";
  let results: D1Result<unknown>[];
  try {
    results = await database.batch([
    database.prepare(`UPDATE account_credit_ledger SET world_code = ?
      WHERE id = ? AND source_key = ? AND account_id = ?
        AND amount = ? AND reason = 'magic_spend'
        AND (world_code IS NULL OR world_code = ?)
        AND NOT EXISTS (
          SELECT 1 FROM account_credit_ledger WHERE source_key = ?
        )`)
      .bind(
        identity.code,
        debitRecordId,
        debitSource,
        input.accountId,
        -MAGIC_GAME_CREDIT_COST,
        identity.code,
        refundSource,
      ),
    database.prepare(`INSERT OR IGNORE INTO magic_worlds (
      code, full_hash, canonical_code, rules_json, creator_account_id, created_at
    ) SELECT ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM account_credit_ledger
        WHERE id = ? AND source_key = ? AND account_id = ?
          AND amount = ? AND reason = 'magic_spend' AND world_code = ?)
        AND NOT EXISTS (
          SELECT 1 FROM account_credit_ledger WHERE source_key = ?
        )`)
      .bind(
        identity.code,
        identity.fullHash,
        identity.canonicalCode,
        rulesJson,
        input.accountId,
        now,
        debitRecordId,
        debitSource,
        input.accountId,
        -MAGIC_GAME_CREDIT_COST,
        identity.code,
        refundSource,
      ),
    database.prepare(`UPDATE magic_rule_compilations SET
      status = 'ready', world_code = ?, lease_token = NULL, lease_until = NULL,
      updated_at = ?
      WHERE ? IS NOT NULL
        AND cache_key = ?
        AND status IN ('compiled', 'ready')
        AND (world_code IS NULL OR world_code = ?)
        AND EXISTS (SELECT 1 FROM magic_worlds
          WHERE code = ? AND full_hash = ? AND canonical_code = ?)`)
      .bind(
        identity.code,
        now,
        compilationCacheKey,
        compilationCacheKey,
        identity.code,
        identity.code,
        identity.fullHash,
        identity.canonicalCode,
      ),
    database.prepare(`INSERT OR IGNORE INTO magic_world_derivations (
      parent_code, child_code, created_by_account_id, created_at
    ) SELECT ?, ?, ?, ?
      WHERE ? IS NOT NULL AND ? <> ?
        AND EXISTS (SELECT 1 FROM account_credit_ledger
          WHERE id = ? AND source_key = ? AND account_id = ?
            AND amount = ? AND reason = 'magic_spend' AND world_code = ?)
        AND NOT EXISTS (
          SELECT 1 FROM account_credit_ledger WHERE source_key = ?
        )
        AND EXISTS (SELECT 1 FROM magic_worlds
          WHERE code = ? AND full_hash = ? AND canonical_code = ?)
        AND NOT EXISTS (
          WITH RECURSIVE descendants(code) AS (
            SELECT ?
            UNION
            SELECT derivations.child_code
            FROM magic_world_derivations AS derivations
            JOIN descendants ON descendants.code = derivations.parent_code
          )
          SELECT 1 FROM descendants WHERE code = ?
        )`)
      .bind(
        parentCode,
        identity.code,
        input.accountId,
        now,
        parentCode,
        parentCode,
        identity.code,
        debitRecordId,
        debitSource,
        input.accountId,
        -MAGIC_GAME_CREDIT_COST,
        identity.code,
        refundSource,
        identity.code,
        identity.fullHash,
        identity.canonicalCode,
        identity.code,
        parentCode,
      ),
    database.prepare(`INSERT OR IGNORE INTO magic_world_sources (
      source_key, world_code, contributor_account_id, prompt_hash,
      compiler_version, parent_code, kind, created_at
    ) SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM account_credit_ledger
        WHERE id = ? AND source_key = ? AND account_id = ?
          AND amount = ? AND reason = 'magic_spend' AND world_code = ?)
        AND NOT EXISTS (
          SELECT 1 FROM account_credit_ledger WHERE source_key = ?
        )
        AND EXISTS (SELECT 1 FROM magic_worlds
          WHERE code = ? AND full_hash = ? AND canonical_code = ?)
        AND (? <> 'fork' OR EXISTS (
          SELECT 1 FROM magic_world_derivations
          WHERE parent_code = ? AND child_code = ?
        ))
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM magic_rule_compilations
          WHERE cache_key = ? AND status = 'ready' AND world_code = ?
        ))`)
      .bind(
        sourceKey,
        identity.code,
        input.accountId,
        promptHash,
        MAGIC_COMPILER_VERSION,
        parentCode,
        kind,
        now,
        debitRecordId,
        debitSource,
        input.accountId,
        -MAGIC_GAME_CREDIT_COST,
        identity.code,
        refundSource,
        identity.code,
        identity.fullHash,
        identity.canonicalCode,
        kind,
        parentCode,
        identity.code,
        compilationCacheKey,
        compilationCacheKey,
        identity.code,
      ),
    database.prepare(`INSERT OR IGNORE INTO magic_world_entitlements (
      game_create_request_id, account_id, world_code, request_fingerprint, created_at
    ) SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM account_credit_ledger
        WHERE id = ? AND source_key = ? AND account_id = ?
          AND amount = ? AND reason = 'magic_spend' AND world_code = ?)
        AND NOT EXISTS (
          SELECT 1 FROM account_credit_ledger WHERE source_key = ?
        )
        AND EXISTS (SELECT 1 FROM magic_worlds
          WHERE code = ? AND full_hash = ? AND canonical_code = ?)
        AND (? <> 'fork' OR EXISTS (
          SELECT 1 FROM magic_world_derivations
          WHERE parent_code = ? AND child_code = ?
        ))
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM magic_rule_compilations
          WHERE cache_key = ? AND status = 'ready' AND world_code = ?
        ))`)
      .bind(
        input.gameCreateRequestId,
        input.accountId,
        identity.code,
        fingerprint,
        now,
        debitRecordId,
        debitSource,
        input.accountId,
        -MAGIC_GAME_CREDIT_COST,
        identity.code,
        refundSource,
        identity.code,
        identity.fullHash,
        identity.canonicalCode,
        kind,
        parentCode,
        identity.code,
        compilationCacheKey,
        compilationCacheKey,
        identity.code,
      ),
    ]);
  } catch (error) {
    if (!(await entitlementFor(input.gameCreateRequestId))) {
      await refundMagicDebit({
        accountId: input.accountId,
        gameCreateRequestId: input.gameCreateRequestId,
        fingerprint,
        worldCode: identity.code,
        createdAt: now,
      });
    }
    throw error;
  }
  const entitlement = await entitlementFor(input.gameCreateRequestId);
  if (
    !entitlement
    || entitlement.account_id !== input.accountId
    || entitlement.world_code !== identity.code
    || entitlement.request_fingerprint !== fingerprint
  ) {
    await refundMagicDebit({
      accountId: input.accountId,
      gameCreateRequestId: input.gameCreateRequestId,
      fingerprint,
      worldCode: identity.code,
      createdAt: now,
    });
    return {
      ok: false,
      code: "idempotency_conflict",
      message: "This Apply Magic request could not be completed safely. Your credit was restored.",
    };
  }
  if (parentCode && parentCode !== identity.code) {
    const edge = await database.prepare(`SELECT 1 AS found FROM magic_world_derivations
      WHERE parent_code = ? AND child_code = ?`)
      .bind(parentCode, identity.code)
      .first<{ found: number }>();
    if (edge?.found !== 1) {
      await database.batch([
        database.prepare("DELETE FROM magic_world_entitlements WHERE game_create_request_id = ?")
          .bind(input.gameCreateRequestId),
        database.prepare("DELETE FROM magic_world_sources WHERE source_key = ?").bind(sourceKey),
      ]);
      await refundMagicDebit({
        accountId: input.accountId,
        gameCreateRequestId: input.gameCreateRequestId,
        fingerprint,
        worldCode: identity.code,
        createdAt: now,
      });
      return {
        ok: false,
        code: "lineage_conflict",
        message: "This fork could not be connected safely. Your credit was restored.",
      };
    }
  }
  const storedIdentity = await databaseWorldIdentity(identity.code);
  if (
    !storedIdentity
    || storedIdentity.full_hash !== identity.fullHash
    || storedIdentity.canonical_code !== identity.canonicalCode
  ) throw new Error("Magic World identity mismatch");
  if (compilationCacheKey) {
    const cache = await database.prepare(`SELECT 1 AS ready
      FROM magic_rule_compilations
      WHERE cache_key = ? AND status = 'ready' AND world_code = ?`)
      .bind(compilationCacheKey, identity.code)
      .first<{ ready: number }>();
    if (cache?.ready !== 1) throw new Error("Applied World compilation is not attached");
  }
  const world = await getMagicWorld(identity.code);
  if (!world) throw new Error("Applied World could not be loaded");
  return {
    ok: true,
    world,
    created: (results[1]?.meta.changes ?? 0) === 1,
    creditBalance: await creditBalance(input.accountId),
    creditCost: MAGIC_GAME_CREDIT_COST,
    gameCreateRequestId: input.gameCreateRequestId,
  };
}

export async function magicWorldForGameCreation(input: {
  accountId: string;
  gameCreateRequestId: string;
  worldCode: unknown;
}): Promise<{
  world: MagicWorldDetail;
  rulesJson: string;
  canonicalPrompt: string;
  creatorAccountId: string | null;
} | null> {
  if (!isMagicWorldCode(input.worldCode)) return null;
  await ensureSchema();
  const entitlement = await entitlementFor(input.gameCreateRequestId);
  if (
    !entitlement
    || entitlement.account_id !== input.accountId
    || entitlement.world_code !== input.worldCode
  ) return null;
  const world = await getMagicWorld(input.worldCode);
  if (!world) return null;
  const identity = await databaseWorldIdentity(input.worldCode);
  if (!identity) return null;
  const rulesJson = serializeMagicRules(world.rules);
  if (!rulesJson) throw new Error("World rules are invalid");
  return {
    world,
    rulesJson,
    canonicalPrompt: world.labels.join(" • "),
    creatorAccountId: identity.creator_account_id,
  };
}

export async function recordMagicWorldGame(input: {
  gameId: string;
  gameCreateRequestId: string;
  accountId: string;
  worldCode: string;
  createdAt: string;
}): Promise<void> {
  if (!isMagicWorldCode(input.worldCode)) return;
  const database = getDatabase();
  const creator = await database
    .prepare("SELECT creator_account_id FROM magic_worlds WHERE code = ?")
    .bind(input.worldCode)
    .first<{ creator_account_id: string | null }>();
  await database.batch([
    database.prepare(`UPDATE magic_world_entitlements SET
      consumed_at = COALESCE(consumed_at, ?),
      game_id = COALESCE(game_id, ?)
      WHERE game_create_request_id = ?
        AND account_id = ?
        AND world_code = ?
        AND (game_id IS NULL OR game_id = ?)`)
      .bind(
        input.createdAt,
        input.gameId,
        input.gameCreateRequestId,
        input.accountId,
        input.worldCode,
        input.gameId,
      ),
    database.prepare(`INSERT OR IGNORE INTO magic_world_uses (
      game_id, world_code, spender_account_id, creator_account_id,
      qualifies_for_royalty, human_played_at, created_at
    ) SELECT ?, ?, ?, ?, 0, NULL, ?
      FROM magic_world_entitlements
      WHERE game_create_request_id = ?
        AND account_id = ?
        AND world_code = ?
        AND game_id = ?`)
      .bind(
        input.gameId,
        input.worldCode,
        input.accountId,
        creator?.creator_account_id ?? null,
        input.createdAt,
        input.gameCreateRequestId,
        input.accountId,
        input.worldCode,
        input.gameId,
      ),
  ]);
}

async function reconcileMagicWorldRoyalty(
  worldCode: string,
  creatorAccountId: string,
  gameId: string,
  createdAt: string,
): Promise<void> {
  const database = getDatabase();

  const [useCount, paid] = await Promise.all([
    database.prepare(`SELECT COUNT(*) AS count FROM magic_world_uses
      WHERE world_code = ? AND creator_account_id = ? AND qualifies_for_royalty = 1`)
      .bind(worldCode, creatorAccountId)
      .first<{ count: number }>(),
    database.prepare(`SELECT COALESCE(SUM(amount), 0) AS credits
      FROM account_credit_ledger
      WHERE account_id = ? AND world_code = ? AND reason = 'world_royalty'`)
      .bind(creatorAccountId, worldCode)
      .first<{ credits: number }>(),
  ]);
  const earned = Math.floor(Number(useCount?.count ?? 0) / WORLD_ROYALTY_GAMES_PER_CREDIT);
  const alreadyPaid = Number(paid?.credits ?? 0);
  for (let bucket = alreadyPaid + 1; bucket <= earned; bucket += 1) {
    const sourceKey = `world-royalty:${worldCode}:${bucket}`;
    await database.prepare(`INSERT OR IGNORE INTO account_credit_ledger (
      id, account_id, amount, reason, source_key, world_code, game_id, created_at
    ) VALUES (?, ?, 1, 'world_royalty', ?, ?, ?, ?)`)
      .bind(
        sourceKey,
        creatorAccountId,
        sourceKey,
        worldCode,
        gameId,
        createdAt,
      )
      .run();
  }
}

export async function markMagicWorldPlayed(gameId: string): Promise<void> {
  await ensureSchema();
  const database = getDatabase();
  const now = new Date().toISOString();
  await database.prepare(`UPDATE magic_world_uses
    SET human_played_at = COALESCE(human_played_at, (
          SELECT MIN(moves.created_at)
          FROM moves
          JOIN game_memberships
            ON game_memberships.game_id = moves.game_id
            AND game_memberships.color = moves.color
          WHERE moves.game_id = ?
        )),
        qualifies_for_royalty = CASE
          WHEN creator_account_id IS NOT NULL
            AND spender_account_id IS NOT NULL
            AND creator_account_id <> spender_account_id
            AND EXISTS (
              SELECT 1
              FROM moves
              JOIN game_memberships
                ON game_memberships.game_id = moves.game_id
                AND game_memberships.color = moves.color
              WHERE moves.game_id = ?
                AND game_memberships.account_id = spender_account_id
            )
          THEN 1 ELSE qualifies_for_royalty END
    WHERE game_id = ?
      AND EXISTS (
        SELECT 1
        FROM moves
        JOIN game_memberships
          ON game_memberships.game_id = moves.game_id
          AND game_memberships.color = moves.color
        WHERE moves.game_id = ?
      )`)
    .bind(gameId, gameId, gameId, gameId)
    .run();
  const use = await database.prepare(`SELECT world_code, creator_account_id
    FROM magic_world_uses
    WHERE game_id = ? AND qualifies_for_royalty = 1`)
    .bind(gameId)
    .first<{
      world_code: string;
      creator_account_id: string | null;
    }>();
  if (!use?.creator_account_id) return;
  await reconcileMagicWorldRoyalty(
    use.world_code,
    use.creator_account_id,
    gameId,
    now,
  );
}
