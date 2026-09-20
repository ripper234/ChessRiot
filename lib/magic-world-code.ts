import {
  MAGIC_RULES_VERSION,
  validateCompiledMagicRules,
  type CompiledMagicRules,
  type ForbiddenAction,
  type MagicPiece,
  type MagicRule,
} from "./magic-rules";

export const MAGIC_WORLD_CODE_VERSION = "chessriot.magic-world/v1";
export const MAGIC_WORLD_BASE_RULES = "standard-chess/v1";
export const MAGIC_WORLD_CODE_PATTERN = /^0x[0-9a-f]{40}$/;
export const MAGIC_WORLD_FULL_HASH_PATTERN = /^0x[0-9a-f]{64}$/;

const PIECE_ORDER: MagicPiece[] = ["p", "n", "b", "r", "q", "k"];
const ACTION_ORDER: ForbiddenAction[] = ["promotion", "castling", "en_passant"];

export interface CanonicalMagicWorldDocument {
  schema: typeof MAGIC_WORLD_CODE_VERSION;
  baseRules: typeof MAGIC_WORLD_BASE_RULES;
  magicRules: {
    version: typeof MAGIC_RULES_VERSION;
    rules: MagicRule[];
  };
}

export interface MagicWorldIdentity {
  code: string;
  fullHash: string;
  canonicalCode: string;
  rules: Extract<CompiledMagicRules, { version: typeof MAGIC_RULES_VERSION }>;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Converts every supported stored rules version into one semantic form. Rule
 * order, grouping, prompt wording, language, and compiler version never affect
 * the result.
 */
export function canonicalMagicWorldRules(
  value: CompiledMagicRules,
): Extract<CompiledMagicRules, { version: typeof MAGIC_RULES_VERSION }> {
  const compiled = validateCompiledMagicRules(value);
  const moveLimits = new Map<MagicPiece, number>();
  const forbidden = new Set<ForbiddenAction>();
  for (const rule of compiled.rules) {
    if (rule.kind === "double_move") {
      moveLimits.set(rule.piece, 2);
    } else if (rule.kind === "move_sequence") {
      for (const piece of rule.pieces) moveLimits.set(piece, rule.maxMoves);
    } else if (rule.kind === "forbid_action") {
      forbidden.add(rule.action);
    } else if (rule.kind === "no_promotion") {
      forbidden.add("promotion");
    } else if (rule.kind === "no_castling") {
      forbidden.add("castling");
    } else if (rule.kind === "no_en_passant") {
      forbidden.add("en_passant");
    }
  }

  const grouped = new Map<number, MagicPiece[]>();
  for (const piece of PIECE_ORDER) {
    const limit = moveLimits.get(piece);
    if (!limit) continue;
    grouped.set(limit, [...(grouped.get(limit) ?? []), piece]);
  }
  const rules: MagicRule[] = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([maxMoves, pieces]) => ({
      kind: "move_sequence" as const,
      pieces,
      maxMoves,
    }));
  for (const action of ACTION_ORDER) {
    if (forbidden.has(action)) rules.push({ kind: "forbid_action", action });
  }
  return validateCompiledMagicRules({
    version: MAGIC_RULES_VERSION,
    rules,
  }) as Extract<CompiledMagicRules, { version: typeof MAGIC_RULES_VERSION }>;
}

export function canonicalMagicWorldDocument(
  value: CompiledMagicRules,
): CanonicalMagicWorldDocument {
  return {
    schema: MAGIC_WORLD_CODE_VERSION,
    baseRules: MAGIC_WORLD_BASE_RULES,
    magicRules: canonicalMagicWorldRules(value),
  };
}

export function canonicalMagicWorldCode(value: CompiledMagicRules): string {
  return JSON.stringify(canonicalMagicWorldDocument(value));
}

export async function magicWorldIdentity(
  value: CompiledMagicRules,
): Promise<MagicWorldIdentity> {
  const rules = canonicalMagicWorldRules(value);
  const canonicalCode = canonicalMagicWorldCode(rules);
  const digest = bytesToHex(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalCode),
  ));
  return {
    code: `0x${digest.slice(0, 40)}`,
    fullHash: `0x${digest}`,
    canonicalCode,
    rules,
  };
}

export function isMagicWorldCode(value: unknown): value is string {
  return typeof value === "string" && MAGIC_WORLD_CODE_PATTERN.test(value);
}

export function displayMagicWorldCode(code: string): string {
  if (!isMagicWorldCode(code)) return "Unknown World";
  return `0x${code.slice(2, 8).toUpperCase()}…${code.slice(-4).toUpperCase()}`;
}
