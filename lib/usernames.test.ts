import { describe, expect, it } from "vitest";
import {
  canonicalUsername,
  normalizedUsername,
  USERNAME_MAX_LENGTH,
  usernameCharacterLength,
  validateUsername,
} from "./usernames";

describe("username validation", () => {
  it("accepts letters and numbers from writing systems worldwide", () => {
    expect(validateUsername("Riot_Knight-81")).toEqual({
      ok: true,
      username: "Riot_Knight-81",
      canonical: "riot_knight-81",
    });
    for (const username of [
      "רון81",
      "فارس_٧",
      "棋手88",
      "Игрок_7",
      "राजा81",
      "𐐀𐐁𐐂",
    ]) {
      expect(validateUsername(username), username).toMatchObject({ ok: true });
    }
  });

  it("keeps compatibility-equivalent and case-equivalent names unique", () => {
    expect(canonicalUsername("  Knight81 ")).toBe("knight81");
    expect(canonicalUsername("Échec81")).toBe(canonicalUsername("E\u0301chec81"));
    expect(canonicalUsername("Straße81")).toBe(canonicalUsername("STRASSE81"));
    expect(canonicalUsername("ΟΣ81")).toBe(canonicalUsername("ος81"));
    expect(canonicalUsername("ᎠᏂ81")).toBe(canonicalUsername("ꭰꮒ81"));
    expect(canonicalUsername("ırmak")).not.toBe(canonicalUsername("irmak"));
  });

  it("keeps destructive confirmation display-exact after safe normalization", () => {
    expect(normalizedUsername("  Straße81 ")).toBe("Straße81");
    expect(normalizedUsername("Straße81")).not.toBe(normalizedUsername("STRASSE81"));
    expect(normalizedUsername("Échec81")).toBe(normalizedUsername("E\u0301chec81"));
  });

  it("rejects unsafe symbols, invisibles, and punctuation placement", () => {
    expect(validateUsername("_knight")).toMatchObject({ ok: false, code: "characters" });
    expect(validateUsername("knight__81")).toMatchObject({ ok: false, code: "characters" });
    expect(validateUsername("knight-")).toMatchObject({ ok: false, code: "characters" });
    expect(validateUsername("knight 81")).toMatchObject({ ok: false, code: "characters" });
    expect(validateUsername("פרש♞81")).toMatchObject({ ok: false, code: "characters" });
    expect(validateUsername("פרש\u200B81")).toMatchObject({ ok: false, code: "characters" });
    expect(validateUsername("פרש\u202E81")).toMatchObject({ ok: false, code: "characters" });
  });

  it("counts graphemes and bounds combining-mark abuse", () => {
    const twentyHebrewGraphemes = "א\u05B0".repeat(USERNAME_MAX_LENGTH);
    expect(usernameCharacterLength(twentyHebrewGraphemes)).toBe(USERNAME_MAX_LENGTH);
    expect(validateUsername(twentyHebrewGraphemes)).toMatchObject({ ok: true });
    expect(validateUsername(`${twentyHebrewGraphemes}ב`)).toMatchObject({
      ok: false,
      code: "length",
    });
    expect(validateUsername(`a${"\u0301".repeat(128)}bc`)).toMatchObject({
      ok: false,
      code: "length",
    });
  });

  it("enforces a bounded, family-safe, non-reserved name", () => {
    expect(validateUsername("ab")).toMatchObject({ ok: false, code: "length" });
    expect(validateUsername("x".repeat(USERNAME_MAX_LENGTH + 1))).toMatchObject({
      ok: false,
      code: "length",
    });
    expect(validateUsername("ChessRiot")).toMatchObject({ ok: false, code: "reserved" });
    expect(validateUsername("adm1n")).toMatchObject({ ok: false, code: "reserved" });
    expect(validateUsername("аdmin")).toMatchObject({ ok: false, code: "reserved" });
    expect(validateUsername("ѕupport")).toMatchObject({ ok: false, code: "reserved" });
    expect(validateUsername("сhessriot")).toMatchObject({ ok: false, code: "reserved" });
    expect(validateUsername("sh1t")).toMatchObject({ ok: false, code: "profanity" });
    expect(validateUsername("f.u-c_k")).toMatchObject({ ok: false, code: "profanity" });
    expect(validateUsername("phuck")).toMatchObject({ ok: false, code: "profanity" });
    expect(validateUsername("fuk")).toMatchObject({ ok: false, code: "profanity" });
  });

  it("does not reject a benign name because it contains an accidental substring", () => {
    expect(validateUsername("Scunthorpe")).toMatchObject({ ok: true });
    expect(validateUsername("Scunthorpe81")).toMatchObject({ ok: true });
    expect(validateUsername("ScunthorpeFuck")).toMatchObject({
      ok: false,
      code: "profanity",
    });
  });
});
