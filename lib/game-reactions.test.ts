import { describe, expect, it } from "vitest";
import {
  isPostGameReactionKey,
  isReactionKey,
  postGameReactionWindowOpen,
  POST_GAME_REACTION_WINDOW_MS,
  reactionPreset,
  REACTION_DAILY_LIMIT,
  REACTION_PRESETS,
  REACTION_RETENTION_DAYS,
  REACTION_STORAGE_LIMIT,
} from "./game-reactions";

describe("kid-safe game reactions", () => {
  it("offers exactly six fixed presets with no custom text path", () => {
    expect(REACTION_PRESETS.map((preset) => preset.key)).toEqual([
      "hi",
      "good_luck",
      "nice_move",
      "well_played",
      "good_game",
      "thanks",
    ]);
    expect(new Set(REACTION_PRESETS.map((preset) => preset.label)).size).toBe(6);
  });

  it("accepts only exact allowlisted keys", () => {
    for (const preset of REACTION_PRESETS) {
      expect(isReactionKey(preset.key)).toBe(true);
      expect(reactionPreset(preset.key)).toBe(preset);
    }
    for (const value of [
      "",
      "NICE_MOVE",
      "hurry_up",
      "<script>alert(1)</script>",
      { key: "hi" },
      1,
      null,
    ]) {
      expect(isReactionKey(value)).toBe(false);
    }
  });

  it("limits completed games to Good Game and Thanks for 15 minutes", () => {
    expect(isPostGameReactionKey("good_game")).toBe(true);
    expect(isPostGameReactionKey("thanks")).toBe(true);
    expect(isPostGameReactionKey("nice_move")).toBe(false);

    const now = Date.parse("2026-07-24T12:00:00.000Z");
    expect(postGameReactionWindowOpen(
      new Date(now - POST_GAME_REACTION_WINDOW_MS).toISOString(),
      now,
    )).toBe(true);
    expect(postGameReactionWindowOpen(
      new Date(now - POST_GAME_REACTION_WINDOW_MS - 1).toISOString(),
      now,
    )).toBe(false);
    expect(postGameReactionWindowOpen(new Date(now + 1).toISOString(), now)).toBe(false);
    expect(postGameReactionWindowOpen(null, now)).toBe(false);
  });

  it("retains more than 100 rows without discarding rate-limit evidence", () => {
    const maximumRetainedRows =
      2 * REACTION_DAILY_LIMIT * REACTION_RETENTION_DAYS;
    expect(maximumRetainedRows).toBeGreaterThan(100);
    expect(REACTION_STORAGE_LIMIT).toBeGreaterThanOrEqual(maximumRetainedRows);
  });
});
