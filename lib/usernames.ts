import { remove as removeConfusables } from "confusables";
import { caseFold } from "unicode-case-folding";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

// Public handles accept letters and digits from every writing system. Marks
// may follow a base character, while separators stay ASCII and internal. The
// profile deliberately excludes whitespace, emoji, controls, bidi overrides,
// and other invisible formatting characters.
const USERNAME_PATTERN = /^\p{L}[\p{L}\p{M}\p{N}]*(?:[._-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*$/u;
const USERNAME_SEGMENTER = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;
const USERNAME_MAX_CODE_POINTS = 128;
const USERNAME_MAX_UTF8_BYTES = 512;
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "chessriot",
  "moderator",
  "riotbot",
  "support",
  "system",
]);
const PROFANITY_ROOTS = [
  "bitch",
  "cunt",
  "faggot",
  "fuck",
  "fuk",
  "motherfuck",
  "nigger",
  "phuck",
  "pussy",
  "shit",
  "slut",
  "whore",
] as const;

// Avoid the classic “Scunthorpe problem” without weakening the general filter.
// Exceptions stay deliberately narrow and only cover a complete benign name
// (optionally followed by digits), never a longer name containing another term.
const PROFANITY_FALSE_POSITIVES: Partial<
  Record<(typeof PROFANITY_ROOTS)[number], readonly RegExp[]>
> = {
  cunt: [/^scunthorpe[0-9]*$/],
};

export type UsernameValidation =
  | { ok: true; username: string; canonical: string }
  | {
      ok: false;
      code:
        | "required"
        | "length"
        | "characters"
        | "reserved"
        | "profanity";
      message: string;
    };

export function normalizedUsername(value: string): string {
  return value.normalize("NFKC").trim();
}

export function canonicalUsername(value: string): string {
  const normalized = normalizedUsername(value);
  return caseFold(normalized).normalize("NFKC");
}

export function usernameCharacterLength(value: string): number {
  const normalized = value.normalize("NFKC");
  return USERNAME_SEGMENTER
    ? Array.from(USERNAME_SEGMENTER.segment(normalized)).length
    : Array.from(normalized).length;
}

function safetyKey(value: string): string {
  return canonicalUsername(value)
    .replace(/[._-]/g, "")
    .replace(/0/g, "o")
    .replace(/[1!]/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/8/g, "b");
}

function compactKey(value: string): string {
  return canonicalUsername(value).replace(/[._-]/g, "");
}

function reservedSafetyKey(value: string): string {
  return canonicalUsername(removeConfusables(value)).replace(/[._-]/g, "");
}

function containsBlockedLanguage(value: string): boolean {
  const compact = compactKey(value);
  const safe = safetyKey(value);
  return PROFANITY_ROOTS.some((root) => {
    if (!safe.includes(root)) return false;
    const exceptions = PROFANITY_FALSE_POSITIVES[root] ?? [];
    return !exceptions.some((pattern) => pattern.test(compact));
  });
}

export function validateUsername(value: unknown): UsernameValidation {
  if (typeof value !== "string" || !value.trim()) {
    return {
      ok: false,
      code: "required",
      message: "Choose a username.",
    };
  }
  const username = normalizedUsername(value);
  const characterLength = usernameCharacterLength(username);
  const codePointLength = Array.from(username).length;
  const byteLength = new TextEncoder().encode(username).byteLength;
  if (
    characterLength < USERNAME_MIN_LENGTH
    || characterLength > USERNAME_MAX_LENGTH
    || codePointLength > USERNAME_MAX_CODE_POINTS
    || byteLength > USERNAME_MAX_UTF8_BYTES
  ) {
    return {
      ok: false,
      code: "length",
      message: `Use ${USERNAME_MIN_LENGTH}–${USERNAME_MAX_LENGTH} characters.`,
    };
  }
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      code: "characters",
      message: "Start with a letter. Use letters from any language, numbers, dots, hyphens, or underscores.",
    };
  }
  const canonical = canonicalUsername(username);
  if (
    RESERVED_USERNAMES.has(canonical)
    || RESERVED_USERNAMES.has(safetyKey(username))
    || RESERVED_USERNAMES.has(reservedSafetyKey(username))
  ) {
    return {
      ok: false,
      code: "reserved",
      message: "That username is reserved. Choose another.",
    };
  }
  if (containsBlockedLanguage(username)) {
    return {
      ok: false,
      code: "profanity",
      message: "Choose a username suitable for everyone.",
    };
  }
  return { ok: true, username, canonical };
}
