export const MAGIC_PROMPT_MAX_LENGTH = 500;
export const MAGIC_RULES_VERSION = 3 as const;
export const PREVIOUS_MAGIC_RULES_VERSION = 2 as const;
export const LEGACY_MAGIC_RULES_VERSION = 1 as const;
export const MAGIC_MAX_MOVES_PER_TURN = 6;

export type MagicPiece = "p" | "n" | "b" | "r" | "q" | "k";
export type DoubleMovePiece = "r" | "n";
export type ForbiddenAction = "promotion" | "castling" | "en_passant";

type SharedLegacyMagicRule =
  | { kind: "no_promotion" }
  | { kind: "no_castling" }
  | { kind: "no_en_passant" };

export type LegacyMagicRule =
  | { kind: "double_move"; piece: "r" }
  | SharedLegacyMagicRule;

export type PreviousMagicRule =
  | { kind: "double_move"; piece: DoubleMovePiece }
  | SharedLegacyMagicRule;

export type MagicRule =
  | {
    kind: "move_sequence";
    pieces: MagicPiece[];
    maxMoves: number;
  }
  | {
    kind: "forbid_action";
    action: ForbiddenAction;
  };

export type AnyMagicRule = LegacyMagicRule | PreviousMagicRule | MagicRule;

export type CompiledMagicRules =
  | {
    version: typeof LEGACY_MAGIC_RULES_VERSION;
    rules: LegacyMagicRule[];
  }
  | {
    version: typeof PREVIOUS_MAGIC_RULES_VERSION;
    rules: PreviousMagicRule[];
  }
  | {
    version: typeof MAGIC_RULES_VERSION;
    rules: MagicRule[];
  };

export type PublicMagicRules = CompiledMagicRules & {
  prompt: string;
  labels: string[];
};

export type MagicPromptValidation =
  | { ok: true; prompt: string }
  | { ok: false; message: string };

const PIECE_NAMES: Record<MagicPiece, string> = {
  p: "Pawns",
  n: "Knights",
  b: "Bishops",
  r: "Rooks",
  q: "Queens",
  k: "Kings",
};

const ALL_MAGIC_PIECES: MagicPiece[] = ["p", "n", "b", "r", "q", "k"];

export function normalizeMagicPrompt(value: unknown): MagicPromptValidation {
  if (typeof value !== "string") {
    return { ok: false, message: "Describe the magic rule in a short sentence." };
  }
  const normalized = value.normalize("NFKC");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    return { ok: false, message: "Magic Rules contain unsupported control characters." };
  }
  const prompt = normalized.trim().replace(/\s+/g, " ");
  if (!prompt) {
    return { ok: false, message: "Describe the magic rule in a short sentence." };
  }
  if (prompt.length > MAGIC_PROMPT_MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep Magic Rules under ${MAGIC_PROMPT_MAX_LENGTH} characters.`,
    };
  }
  return { ok: true, prompt };
}

function sortedUniquePieces(pieces: MagicPiece[]): MagicPiece[] {
  const selected = new Set(pieces);
  return ALL_MAGIC_PIECES.filter((piece) => selected.has(piece));
}

function ruleKey(rule: AnyMagicRule): string {
  if (rule.kind === "double_move") return `move_sequence:${rule.piece}`;
  if (rule.kind === "move_sequence") {
    return `move_sequence:${sortedUniquePieces(rule.pieces).join("")}`;
  }
  if (rule.kind === "forbid_action") return `forbid_action:${rule.action}`;
  return rule.kind;
}

function isMagicPiece(value: unknown): value is MagicPiece {
  return typeof value === "string" && ALL_MAGIC_PIECES.includes(value as MagicPiece);
}

function isForbiddenAction(value: unknown): value is ForbiddenAction {
  return value === "promotion" || value === "castling" || value === "en_passant";
}

function isLegacyRule(value: unknown, version: 1 | 2): value is PreviousMagicRule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { kind?: unknown; piece?: unknown };
  if (
    candidate.kind === "no_promotion"
    || candidate.kind === "no_castling"
    || candidate.kind === "no_en_passant"
  ) {
    return candidate.piece === undefined;
  }
  if (candidate.kind !== "double_move") return false;
  return candidate.piece === "r"
    || (version === PREVIOUS_MAGIC_RULES_VERSION && candidate.piece === "n");
}

function isV3Rule(value: unknown): value is MagicRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as {
    kind?: unknown;
    pieces?: unknown;
    maxMoves?: unknown;
    action?: unknown;
  };
  if (candidate.kind === "forbid_action") {
    return isForbiddenAction(candidate.action)
      && candidate.pieces === undefined
      && candidate.maxMoves === undefined;
  }
  if (candidate.kind !== "move_sequence") return false;
  return Array.isArray(candidate.pieces)
    && candidate.pieces.length > 0
    && candidate.pieces.length <= ALL_MAGIC_PIECES.length
    && candidate.pieces.every(isMagicPiece)
    && new Set(candidate.pieces).size === candidate.pieces.length
    && Number.isInteger(candidate.maxMoves)
    && (candidate.maxMoves as number) >= 2
    && (candidate.maxMoves as number) <= MAGIC_MAX_MOVES_PER_TURN
    && candidate.action === undefined;
}

export function validateCompiledMagicRules(value: unknown): CompiledMagicRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Compiled magic rules are invalid");
  }
  const candidate = value as { version?: unknown; rules?: unknown };
  if (!Array.isArray(candidate.rules) || candidate.rules.length === 0 || candidate.rules.length > 6) {
    throw new Error("Compiled magic rules are invalid");
  }
  if (
    candidate.version === LEGACY_MAGIC_RULES_VERSION
    || candidate.version === PREVIOUS_MAGIC_RULES_VERSION
  ) {
    if (!candidate.rules.every((rule) =>
      isLegacyRule(rule, candidate.version as 1 | 2))) {
      throw new Error("Compiled magic rules are invalid");
    }
  } else if (
    candidate.version !== MAGIC_RULES_VERSION
    || !candidate.rules.every(isV3Rule)
  ) {
    throw new Error("Compiled magic rules are invalid");
  }

  const rules = candidate.rules as AnyMagicRule[];
  const unique = new Set(rules.map(ruleKey));
  if (unique.size !== rules.length) {
    throw new Error("Compiled magic rules are invalid");
  }

  const moveCounts = new Map<MagicPiece, number>();
  for (const rule of rules) {
    if (rule.kind === "double_move") {
      if (moveCounts.has(rule.piece)) throw new Error("Compiled magic rules are invalid");
      moveCounts.set(rule.piece, 2);
    }
    if (rule.kind === "move_sequence") {
      for (const piece of rule.pieces) {
        if (moveCounts.has(piece)) throw new Error("Compiled magic rules are invalid");
        moveCounts.set(piece, rule.maxMoves);
      }
    }
  }

  return candidate as CompiledMagicRules;
}

export function magicRuleLabel(rule: AnyMagicRule): string {
  if (rule.kind === "double_move") {
    return `${PIECE_NAMES[rule.piece]} may move up to 2 times per turn; check ends the turn`;
  }
  if (rule.kind === "move_sequence") {
    const pieces = sortedUniquePieces(rule.pieces);
    const subject = pieces.length === ALL_MAGIC_PIECES.length
      ? "Every piece"
      : pieces.map((piece) => PIECE_NAMES[piece]).join(", ");
    return `${subject} may move up to ${rule.maxMoves} times per turn; check ends the turn`;
  }
  const action = rule.kind === "forbid_action"
    ? rule.action
    : rule.kind === "no_promotion"
      ? "promotion"
      : rule.kind === "no_castling"
        ? "castling"
        : "en_passant";
  if (action === "promotion") return "Pawns cannot move onto the final rank";
  if (action === "castling") return "No castling";
  return "No en passant";
}

export function serializeMagicRules(rules: CompiledMagicRules | null): string | null {
  return rules ? JSON.stringify(rules) : null;
}

export function parseStoredMagicRules(value: string | null | undefined): CompiledMagicRules | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Stored magic rules are invalid");
  }
  try {
    return validateCompiledMagicRules(parsed);
  } catch {
    throw new Error("Stored magic rules are invalid");
  }
}

export function magicMoveLimit(
  rules: CompiledMagicRules | null | undefined,
  piece: MagicPiece,
): number {
  let limit = 1;
  for (const rule of rules?.rules ?? []) {
    if (rule.kind === "double_move" && rule.piece === piece) limit = Math.max(limit, 2);
    if (rule.kind === "move_sequence" && rule.pieces.includes(piece)) {
      limit = Math.max(limit, rule.maxMoves);
    }
  }
  return limit;
}

export function hasMagicRule(
  rules: CompiledMagicRules | null | undefined,
  kind: "double_move" | "no_promotion" | "no_castling" | "no_en_passant",
  piece?: MagicPiece,
): boolean {
  if (kind === "double_move") {
    return piece !== undefined && magicMoveLimit(rules, piece) > 1;
  }
  const action: ForbiddenAction = kind === "no_promotion"
    ? "promotion"
    : kind === "no_castling"
      ? "castling"
      : "en_passant";
  return Boolean(rules?.rules.some((rule) =>
    (rule.kind === "forbid_action" && rule.action === action)
    || (action === "promotion" && rule.kind === "no_promotion")
    || (action === "castling" && rule.kind === "no_castling")
    || (action === "en_passant" && rule.kind === "no_en_passant")));
}

export function publicMagicRules(
  prompt: string | null | undefined,
  compiled: CompiledMagicRules | null,
): PublicMagicRules | null {
  if (!prompt || !compiled) return null;
  return {
    ...compiled,
    prompt,
    labels: compiled.rules.map(magicRuleLabel),
  };
}
