import { describe, expect, it } from "vitest";
import { THEME_MUSIC_PROFILES } from "./theme-music";
import { THEMES } from "./themes";

describe("theme music scores", () => {
  it("gives every skin a complete sixteen-step, four-layer score", () => {
    expect(Object.keys(THEME_MUSIC_PROFILES).sort()).toEqual(
      THEMES.map((theme) => theme.id).sort(),
    );

    for (const theme of THEMES) {
      const profile = THEME_MUSIC_PROFILES[theme.id];
      expect(profile.bpm).toBeGreaterThanOrEqual(60);
      expect(profile.bpm).toBeLessThanOrEqual(150);
      expect(profile.swing).toBeGreaterThanOrEqual(0);
      expect(profile.swing).toBeLessThan(0.2);
      expect(profile.lead.pattern).toHaveLength(16);
      expect(profile.bass.pattern).toHaveLength(16);
      expect(profile.harmony.pattern).toHaveLength(16);
      expect(profile.percussion.pattern).toHaveLength(16);
      expect(profile.lead.pattern.some((step) => step !== null)).toBe(true);
      expect(profile.bass.pattern.some((step) => step !== null)).toBe(true);
      expect(profile.harmony.pattern.some(Array.isArray)).toBe(true);
      expect(profile.percussion.pattern.filter(Boolean).length).toBeGreaterThanOrEqual(2);
      expect(new Set([
        JSON.stringify(profile.lead.pattern),
        JSON.stringify(profile.bass.pattern),
        JSON.stringify(profile.harmony.pattern),
      ]).size).toBe(3);
    }
  });

  it("keeps every skin's rhythm, timbre, and voicing signature unique", () => {
    const signatures = Object.values(THEME_MUSIC_PROFILES).map((profile) => JSON.stringify({
      bpm: profile.bpm,
      swing: profile.swing,
      rootHz: profile.rootHz,
      waves: [
        profile.lead.wave,
        profile.bass.wave,
        profile.harmony.wave,
        profile.percussion.wave,
      ],
      lead: profile.lead.pattern,
      bass: profile.bass.pattern,
      harmony: profile.harmony.pattern,
      pulse: profile.percussion.pattern,
    }));

    expect(new Set(signatures).size).toBe(THEMES.length);
  });

  it("gives Mythic Beasts an epic syncopated creature-court motif", () => {
    const profile = THEME_MUSIC_PROFILES["mythic-beasts"];
    expect(profile.lead.wave).toBe("sawtooth");
    expect(profile.bass.wave).toBe("triangle");
    expect(profile.harmony.pattern[0]).toEqual([0, 7, 10]);
    expect(profile.percussion.pattern).toEqual([
      true, false, false, true,
      false, false, true, false,
      true, false, true, false,
      false, true, false, true,
    ]);
  });
});

