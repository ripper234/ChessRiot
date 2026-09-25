import { afterEach, describe, expect, it, vi } from "vitest";
import { reportClientEvent, reportNotificationBoardPaint, reportProductEvent } from "./client-telemetry";

describe("client telemetry identifiers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the portable secure UUID helper when randomUUID is unavailable", () => {
    const secureCrypto = globalThis.crypto;
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("crypto", {
      getRandomValues: secureCrypto.getRandomValues.bind(secureCrypto),
    });
    vi.stubGlobal("fetch", fetchMock);

    reportProductEvent("public.home_viewed");
    reportClientEvent("client.error", "preview_runtime");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const options = call[1] as RequestInit;
      const payload = JSON.parse(String(options.body)) as { requestId?: unknown };
      expect(payload.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("reports a bounded timing with only a duration and window category", () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    reportNotificationBoardPaint(732, "new-window");
    reportNotificationBoardPaint(120_001, "same-game");
    expect(fetchMock).toHaveBeenCalledOnce();
    const payload = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(payload).toEqual({
      requestId: expect.any(String),
      event: "notification.board_painted",
      elapsedMs: 732,
      mode: "new-window",
    });
  });
});
