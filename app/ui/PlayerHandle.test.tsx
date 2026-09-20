import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerHandle } from "./PlayerHandle";

describe("PlayerHandle", () => {
  it("isolates right-to-left usernames from the surrounding interface", () => {
    const html = renderToStaticMarkup(<PlayerHandle username="רון_81" />);
    expect(html).toBe('<bdi dir="auto">@רון_81</bdi>');
  });
});
