export const MAGIC_PROMPT_MAX_LENGTH = 500;
export const MAGIC_RULES_VERSION = 1 as const;

export type MagicRule =
  | { kind: "double_move"; piece: "r" }
  | { kind: "no_promotion" }
  | { kind: "no_castling" }
  | { kind: "no_en_passant" };

export interface CompiledMagicRules {
  version: typeof MAGIC_RULES_VERSION;
  rules: MagicRule[];
}

export interface PublicMagicRules extends CompiledMagicRules {
  prompt: string;
  labels: string[];
}

export type MagicPromptResult =
  | {
    ok: true;
    prompt: string;
    compiled: CompiledMagicRules;
    labels: string[];
  }
  | {
    ok: false;
    message: string;
    unsupported: string[];
  };

function ruleKey(rule: MagicRule): string {
  return "piece" in rule ? `${rule.kind}:${rule.piece}` : rule.kind;
}

export function magicRuleLabel(rule: MagicRule): string {
  switch (rule.kind) {
    case "double_move":
      return "Rooks may move twice; check ends the turn";
    case "no_promotion":
      return "Pawns cannot move onto the final rank";
    case "no_castling":
      return "No castling";
    case "no_en_passant":
      return "No en passant";
  }
}

function normalizeClause(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[“”]/g, "\"")
    .replace(/[’]/g, "'")
    .replace(
      /^(?:(?:please|also)\s+|rule\s*:?\s*|make\s+it\s+so\s+(?:that\s+)?)+/,
      "",
    )
    .replace(/\s+/g, " ")
    .replace(/[!?]+$/g, "")
    .trim();
}

function splitClauses(prompt: string): string[] {
  return prompt
    .split(/(?:[\n.;]+|,\s*|\s+(?:and|plus|but)\s+)/i)
    .map(normalizeClause)
    .filter(Boolean);
}

function parseClause(clause: string): MagicRule | null {
  if (
    /^(?:the\s+)?rooks?\s+(?:(?:can|may)\s+)?moves?\s+twice(?:\s+per\s+turn)?$/.test(clause)
    || /^(?:the\s+)?rooks?\s+(?:gets?|has|have)\s+two\s+moves(?:\s+per\s+turn)?$/.test(clause)
    || /^(?:צריח|צריחים)\s+(?:זז|זזים|נע|נעים)\s+פעמיים$/.test(clause)
  ) {
    return { kind: "double_move", piece: "r" };
  }

  if (
    /^(?:the\s+)?pawns?\s+(?:never|cannot|can't|do\s+not|don't)\s+(?:(?:get|be)\s+)?promot(?:e|ed)$/.test(clause)
    || /^(?:no|disable|forbid)\s+pawn\s+promotion$/.test(clause)
    || /^(?:חייל|חיילים|רגלי|רגלים)\s+לא\s+(?:מוכתר|מוכתרים|מקודם|מקודמים)$/.test(clause)
  ) {
    return { kind: "no_promotion" };
  }

  if (
    /^(?:no|disable|forbid)\s+castling$/.test(clause)
    || /^castling\s+(?:is\s+)?(?:not\s+allowed|disabled|forbidden)$/.test(clause)
    || /^(?:בלי|ללא)\s+הצרחה$/.test(clause)
  ) {
    return { kind: "no_castling" };
  }

  if (
    /^(?:no|disable|forbid)\s+en[\s-]*passant$/.test(clause)
    || /^en[\s-]*passant\s+(?:is\s+)?(?:not\s+allowed|disabled|forbidden)$/.test(clause)
  ) {
    return { kind: "no_en_passant" };
  }

  return null;
}

export function compileMagicPrompt(value: unknown): MagicPromptResult {
  if (typeof value !== "string") {
    return {
      ok: false,
      message: "Describe the magic rule in a short sentence.",
      unsupported: [],
    };
  }
  const normalized = value.normalize("NFKC");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
    return {
      ok: false,
      message: "Magic Rules contain unsupported control characters.",
      unsupported: [],
    };
  }
  const prompt = normalized.trim().replace(/\s+/g, " ");
  if (!prompt) {
    return {
      ok: false,
      message: "Describe the magic rule in a short sentence.",
      unsupported: [],
    };
  }
  if (prompt.length > MAGIC_PROMPT_MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep Magic Rules under ${MAGIC_PROMPT_MAX_LENGTH} characters.`,
      unsupported: [],
    };
  }

  const clauses = splitClauses(normalized);
  const parsed = clauses.map((clause) => ({ clause, rule: parseClause(clause) }));
  const unsupported = parsed.filter((item) => !item.rule).map((item) => item.clause);
  if (unsupported.length > 0) {
    return {
      ok: false,
      message: `Magic does not understand: “${unsupported[0]}”.`,
      unsupported,
    };
  }

  const rules = parsed
    .map((item) => item.rule)
    .filter((rule): rule is MagicRule => Boolean(rule));
  const deduplicated = [...new Map(rules.map((rule) => [ruleKey(rule), rule])).values()];
  if (deduplicated.length === 0) {
    return {
      ok: false,
      message: "Try a rule such as “Rooks move twice.”",
      unsupported: [],
    };
  }
  if (deduplicated.length > 6) {
    return {
      ok: false,
      message: "Use up to six Magic Rules in one game.",
      unsupported: [],
    };
  }

  const compiled: CompiledMagicRules = {
    version: MAGIC_RULES_VERSION,
    rules: deduplicated,
  };
  return {
    ok: true,
    prompt,
    compiled,
    labels: deduplicated.map(magicRuleLabel),
  };
}

function isMagicRule(value: unknown): value is MagicRule {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { kind?: unknown; piece?: unknown };
  if (
    candidate.kind === "no_promotion"
    || candidate.kind === "no_castling"
    || candidate.kind === "no_en_passant"
  ) {
    return candidate.piece === undefined;
  }
  if (candidate.kind === "double_move") return candidate.piece === "r";
  return false;
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
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Stored magic rules are invalid");
  }
  const candidate = parsed as { version?: unknown; rules?: unknown };
  if (
    candidate.version !== MAGIC_RULES_VERSION
    || !Array.isArray(candidate.rules)
    || candidate.rules.length === 0
    || candidate.rules.length > 6
    || !candidate.rules.every(isMagicRule)
  ) {
    throw new Error("Stored magic rules are invalid");
  }
  const unique = new Set(candidate.rules.map(ruleKey));
  if (unique.size !== candidate.rules.length) {
    throw new Error("Stored magic rules are invalid");
  }
  return {
    version: MAGIC_RULES_VERSION,
    rules: candidate.rules,
  };
}

export function hasMagicRule(
  rules: CompiledMagicRules | null | undefined,
  kind: MagicRule["kind"],
  piece?: "r",
): boolean {
  return Boolean(rules?.rules.some((rule) =>
    rule.kind === kind && (piece === undefined || ("piece" in rule && rule.piece === piece))));
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
