import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MagicCompileStatus } from "@/app/ui/MagicCompileStatus";

describe("Magic compiler status", () => {
  it("shows an active thinking indicator while compiling", () => {
    const html = renderToStaticMarkup(createElement(MagicCompileStatus, {
      state: "thinking",
    }));
    expect(html).toContain("magic-thinking-spinner");
    expect(html).toContain("THINKING");
    expect(html).toContain('role="status"');
  });

  it("shows a green success indicator and the compiled rule labels", () => {
    const html = renderToStaticMarkup(createElement(MagicCompileStatus, {
      state: "success",
      labels: ["Knights move up to 3 times"],
    }));
    expect(html).toContain("success");
    expect(html).toContain("✓");
    expect(html).toContain("COMPILED");
    expect(html).toContain("Knights move up to 3 times");
  });

  it("shows a red failure indicator with the compiler error", () => {
    const html = renderToStaticMarkup(createElement(MagicCompileStatus, {
      state: "failure",
      message: "That rule is not supported yet.",
    }));
    expect(html).toContain("failure");
    expect(html).toContain("×");
    expect(html).toContain("FAILED");
    expect(html).toContain("That rule is not supported yet.");
    expect(html).toContain('role="alert"');
  });
});
