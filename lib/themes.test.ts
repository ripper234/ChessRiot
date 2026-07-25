import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  isThemeId,
  normalizeTheme,
  THEME_BOOTSTRAP_SCRIPT,
  THEMES,
} from "./themes";

describe("visual themes", () => {
  it("offers eleven unique, original theme choices", () => {
    expect(THEMES).toHaveLength(11);
    expect(new Set(THEMES.map((theme) => theme.id)).size).toBe(11);
    expect(THEMES.every((theme) => theme.preview.length === 4)).toBe(true);
    expect(THEMES.map((theme) => theme.name)).not.toEqual(
      expect.arrayContaining([
        "Minecraft",
        "Roblox",
        "Brawl Stars",
        "Warcraft",
        "Magic: The Gathering",
      ]),
    );
  });

  it("uses only local optimized artwork for illustrated themes", () => {
    const illustratedThemes = THEMES.filter((theme) => theme.art);

    expect(illustratedThemes).toHaveLength(7);
    for (const theme of illustratedThemes) {
      expect(theme.art).toMatch(/^\/themes\/[a-z-]+\.webp$/);
    }
  });

  it("normalizes unsupported storage values to the default", () => {
    expect(isThemeId(DEFAULT_THEME)).toBe(true);
    expect(normalizeTheme("classic")).toBe("classic");
    expect(normalizeTheme("CLASSIC")).toBe(DEFAULT_THEME);
    expect(normalizeTheme("not-a-theme")).toBe(DEFAULT_THEME);
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
  });

  it("bootstraps only whitelisted local theme ids before paint", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("localStorage.getItem");
    for (const theme of THEMES) expect(THEME_BOOTSTRAP_SCRIPT).toContain(theme.id);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("allowed.includes(value)");
  });
});
