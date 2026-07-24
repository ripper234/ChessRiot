import type { Color } from "./game-types";

export const REACTION_PRESETS = [
  { key: "hi", icon: "👋", label: "HI!" },
  { key: "good_luck", icon: "☀", label: "GOOD LUCK!" },
  { key: "nice_move", icon: "◆", label: "NICE MOVE!" },
  { key: "well_played", icon: "♜", label: "WELL PLAYED!" },
  { key: "good_game", icon: "⚑", label: "GOOD GAME!" },
  { key: "thanks", icon: "♥", label: "THANKS!" },
] as const;

export type ReactionKey = (typeof REACTION_PRESETS)[number]["key"];

export const POST_GAME_REACTION_WINDOW_MS = 15 * 60 * 1_000;
export const POST_GAME_REACTION_KEYS = ["good_game", "thanks"] as const;
export const REACTION_DAILY_LIMIT = 60;
export const REACTION_RETENTION_DAYS = 30;
// Preserve every request-id and rate-limit record that can legitimately be
// created during the retention window: two seats × 60 reactions × 30 days.
export const REACTION_STORAGE_LIMIT =
  2 * REACTION_DAILY_LIMIT * REACTION_RETENTION_DAYS;

export interface PublicReaction {
  id: string;
  sequence: number;
  senderColor: Color;
  key: ReactionKey;
  createdAt: string;
}

export function isReactionKey(value: unknown): value is ReactionKey {
  return REACTION_PRESETS.some((preset) => preset.key === value);
}

export function reactionPreset(key: ReactionKey) {
  return REACTION_PRESETS.find((preset) => preset.key === key)!;
}

export function isPostGameReactionKey(key: ReactionKey): boolean {
  return POST_GAME_REACTION_KEYS.some((candidate) => candidate === key);
}

export function postGameReactionWindowOpen(
  finishedAt: string | null | undefined,
  nowMs = Date.now(),
): boolean {
  const finishedAtMs = Date.parse(finishedAt ?? "");
  return Number.isFinite(finishedAtMs)
    && finishedAtMs <= nowMs
    && nowMs - finishedAtMs <= POST_GAME_REACTION_WINDOW_MS;
}
