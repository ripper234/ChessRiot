import {
  MAGIC_MAX_MOVES_PER_TURN,
  MAGIC_RULES_VERSION,
  magicRuleLabel,
  normalizeMagicPrompt,
  validateCompiledMagicRules,
  type CompiledMagicRules,
  type ForbiddenAction,
  type MagicPiece,
  type MagicRule,
} from "./magic-rules";
import { openAiApiKey } from "./runtime";

export const MAGIC_COMPILER_MODEL = "gpt-5.6-luna";
export const MAGIC_COMPILER_VERSION =
  `runtime-magic-v3:${MAGIC_COMPILER_MODEL}:2026-07-28`;

export type MagicInterpretationResult =
  | {
    ok: true;
    prompt: string;
    compiled: CompiledMagicRules;
    labels: string[];
  }
  | {
    ok: false;
    code: "invalid_prompt" | "unsupported" | "ambiguous" | "unavailable";
    message: string;
  };

interface ModelRule {
  kind: "move_sequence" | "forbid_action";
  pieces: Array<MagicPiece>;
  maxMoves: number | null;
  action: ForbiddenAction | null;
}

interface ModelInterpretation {
  verdict: "supported" | "unsupported" | "ambiguous";
  rules: ModelRule[];
  message: string;
}

interface InterpreterOptions {
  apiKey?: string | null;
  fetch?: typeof fetch;
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "rules", "message"],
  properties: {
    verdict: {
      type: "string",
      enum: ["supported", "unsupported", "ambiguous"],
    },
    rules: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "pieces", "maxMoves", "action"],
        properties: {
          kind: {
            type: "string",
            enum: ["move_sequence", "forbid_action"],
          },
          pieces: {
            type: "array",
            maxItems: 6,
            items: {
              type: "string",
              enum: ["p", "n", "b", "r", "q", "k"],
            },
          },
          maxMoves: {
            type: ["integer", "null"],
            minimum: 2,
            maximum: MAGIC_MAX_MOVES_PER_TURN,
          },
          action: {
            type: ["string", "null"],
            enum: ["promotion", "castling", "en_passant", null],
          },
        },
      },
    },
    message: {
      type: "string",
      maxLength: 180,
    },
  },
} as const;

export const MAGIC_COMPILER_SYSTEM_PROMPT = `You translate a player's natural-language chess house rules into ChessRiot's deterministic rule language.

Interpret meaning, not wording. The input may be in any language. Never write or request executable code.

The engine supports only:
1. move_sequence: one or more standard piece types may move up to a stated number of consecutive times in one player's turn. Eligibility and the move limit are determined by the piece type at the start of the turn. The same physical piece moves on every leg, even if a pawn promotes. Every leg must be a legal standard chess move from the updated position. The player may stop early after any leg. Giving check ends the turn immediately. Supported piece codes: p pawn, n knight, b bishop, r rook, q queen, k king. The limit must be an integer from 2 through ${MAGIC_MAX_MOVES_PER_TURN}. Treat "twice" as 2 and "three times" as 3.
2. forbid_action: forbid pawn promotion, castling, or en passant.

Use verdict "supported" only when the complete request can be represented exactly by those semantics. If any clause is unsupported, reject the entire request. Consolidate piece types that have the same move limit into one move_sequence rule. Use an empty message for supported results.

Use verdict "ambiguous" when a crucial meaning or count is unclear, and ask one short clarification in message.
Use verdict "unsupported" when any requested behavior is outside the engine, and explain the unsupported behavior briefly in message.

For move_sequence, action must be null. For forbid_action, pieces must be empty and maxMoves must be null. Return no rules unless verdict is supported.`;

function outputText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const output = (value as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        part
        && typeof part === "object"
        && (part as { type?: unknown }).type === "output_text"
        && typeof (part as { text?: unknown }).text === "string"
      ) {
        return (part as { text: string }).text;
      }
    }
  }
  return null;
}

function asCompiledRules(model: ModelInterpretation): CompiledMagicRules {
  if (model.verdict !== "supported" || model.rules.length === 0) {
    throw new Error("Interpretation did not contain supported rules");
  }
  const rules: MagicRule[] = model.rules.map((rule) => {
    if (rule.kind === "move_sequence") {
      if (
        rule.action !== null
        || rule.pieces.length === 0
        || rule.maxMoves === null
      ) {
        throw new Error("Move sequence rule is invalid");
      }
      return {
        kind: "move_sequence",
        pieces: rule.pieces,
        maxMoves: rule.maxMoves,
      };
    }
    if (
      rule.action === null
      || rule.pieces.length !== 0
      || rule.maxMoves !== null
    ) {
      throw new Error("Forbidden action rule is invalid");
    }
    return {
      kind: "forbid_action",
      action: rule.action,
    };
  });
  return validateCompiledMagicRules({
    version: MAGIC_RULES_VERSION,
    rules,
  });
}

function isModelInterpretation(value: unknown): value is ModelInterpretation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as {
    verdict?: unknown;
    rules?: unknown;
    message?: unknown;
  };
  if (
    Object.keys(candidate).length !== 3
    || !["supported", "unsupported", "ambiguous"].includes(String(candidate.verdict))
    || !Array.isArray(candidate.rules)
    || candidate.rules.length > 6
    || typeof candidate.message !== "string"
    || candidate.message.length > 180
  ) return false;
  return candidate.rules.every((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const rule = value as {
      kind?: unknown;
      pieces?: unknown;
      maxMoves?: unknown;
      action?: unknown;
    };
    return Object.keys(rule).length === 4
      && (rule.kind === "move_sequence" || rule.kind === "forbid_action")
      && Array.isArray(rule.pieces)
      && rule.pieces.length <= 6
      && rule.pieces.every((piece) =>
        piece === "p" || piece === "n" || piece === "b"
        || piece === "r" || piece === "q" || piece === "k")
      && (
        rule.maxMoves === null
        || (Number.isInteger(rule.maxMoves)
          && (rule.maxMoves as number) >= 2
          && (rule.maxMoves as number) <= MAGIC_MAX_MOVES_PER_TURN)
      )
      && (
        rule.action === null
        || rule.action === "promotion"
        || rule.action === "castling"
        || rule.action === "en_passant"
      );
  });
}

export async function interpretMagicPrompt(
  value: unknown,
  options: InterpreterOptions = {},
): Promise<MagicInterpretationResult> {
  const normalized = normalizeMagicPrompt(value);
  if (!normalized.ok) {
    return {
      ok: false,
      code: "invalid_prompt",
      message: normalized.message,
    };
  }
  const apiKey = options.apiKey === undefined ? openAiApiKey() : options.apiKey;
  if (!apiKey) {
    return {
      ok: false,
      code: "unavailable",
      message: "Magic interpretation is temporarily unavailable.",
    };
  }

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: MAGIC_COMPILER_MODEL,
        store: false,
        reasoning: { effort: "low" },
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: MAGIC_COMPILER_SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: normalized.prompt }],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "chessriot_magic_rules",
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        },
      }),
    });
  } catch {
    return {
      ok: false,
      code: "unavailable",
      message: "Magic could not interpret that rule right now. Try again.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: "unavailable",
      message: "Magic could not interpret that rule right now. Try again.",
    };
  }

  try {
    const payload: unknown = await response.json();
    const text = outputText(payload);
    if (!text) throw new Error("Missing model output");
    const model: unknown = JSON.parse(text);
    if (!isModelInterpretation(model)) {
      throw new Error("Invalid model output");
    }
    if (model.verdict !== "supported") {
      if (model.rules.length !== 0) throw new Error("Rejected output included rules");
      return {
        ok: false,
        code: model.verdict,
        message: model.message.trim()
          || (model.verdict === "ambiguous"
            ? "Magic needs one more detail."
            : "That rule is not supported yet."),
      };
    }
    const compiled = asCompiledRules(model);
    return {
      ok: true,
      prompt: normalized.prompt,
      compiled,
      labels: compiled.rules.map(magicRuleLabel),
    };
  } catch {
    return {
      ok: false,
      code: "unavailable",
      message: "Magic could not safely validate that rule. Try rephrasing it.",
    };
  }
}
