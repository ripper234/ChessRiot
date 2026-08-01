import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequiredTextInput } from "./RequiredTextInput";

describe("RequiredTextInput", () => {
  it("connects an invalid field to a visible, accessible error", () => {
    const html = renderToStaticMarkup(
      <RequiredTextInput
        id="player-name"
        label="Your display name"
        value=""
        error="Enter your display name to start a game."
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('class="required-field has-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="player-name-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("Enter your display name to start a game.");
  });

  it("keeps a valid required field out of the error state", () => {
    const html = renderToStaticMarkup(
      <RequiredTextInput
        id="player-name"
        label="Your display name"
        value="Ron"
        error=""
        onChange={() => undefined}
      />,
    );

    expect(html).toContain('required=""');
    expect(html).toContain('aria-invalid="false"');
    expect(html).not.toContain('role="alert"');
  });
});
