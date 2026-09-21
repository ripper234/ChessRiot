import { describe, expect, it } from "vitest";
import { translate } from "./locale";
import catalog from "./he.json";
describe("account language", () => {
  it("uses English by default and preserves unknown or user authored text", () => {
    expect(translate("en", "Settings")).toBe("Settings");
    expect(translate("he", "Settings")).toBe("הגדרות");
    expect(translate("he", "Unexpected server response")).toBe("Unexpected server response");
    expect(translate("he", "אישור בעברית שנשמר קודם")).toBe("אישור בעברית שנשמר קודם");
  });
  it("keeps identical named parameters in both languages without raw expressions", () => {
    for (const [en, he] of Object.entries(catalog)) {
      const params = (s: string) => [...s.matchAll(/\$\{([^}]+)\}/g)].map(match => match[1]).sort();
      expect(params(he), en).toEqual(params(en));
      const values = Object.fromEntries(params(en).map(name => [name, "value"]));
      expect(translate("he", en, values), en).not.toContain("${");
      expect(translate("en", en, values), en).not.toContain("${");
    }
  });
});
