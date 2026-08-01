import { describe, expect, it } from "vitest";
import {
  clearRequiredTextError,
  requiredTextError,
} from "./form-validation";

describe("required text fields", () => {
  it("rejects empty and whitespace-only values with the field-specific message", () => {
    expect(requiredTextError("", "Enter a name.")).toBe("Enter a name.");
    expect(requiredTextError("   ", "Enter a name.")).toBe("Enter a name.");
    expect(requiredTextError(" Ron ", "Enter a name.")).toBe("");
  });

  it("clears a displayed error as soon as the value becomes valid", () => {
    expect(clearRequiredTextError(" ", "Enter a name.")).toBe("Enter a name.");
    expect(clearRequiredTextError("Ron", "Enter a name.")).toBe("");
    expect(clearRequiredTextError("", "")).toBe("");
  });
});
