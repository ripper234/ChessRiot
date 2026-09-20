import { afterEach, describe, expect, it, vi } from "vitest";
import { reportClientEvent, reportProductEvent } from "./client-telemetry";

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
});
