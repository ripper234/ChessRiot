import { describe, expect, it, vi } from "vitest";
import {
  fetchJsonWithReadTimeout,
  fetchWithReadTimeout,
  gamePollingIntervalMs,
  lowResourceConnection,
  recoveryDelayMs,
} from "./client-recovery";

describe("client recovery", () => {
  it("uses bounded exponential-style retry delays", () => {
    expect(recoveryDelayMs(-1)).toBe(1_500);
    expect(recoveryDelayMs(0)).toBe(1_500);
    expect(recoveryDelayMs(2)).toBe(7_000);
    expect(recoveryDelayMs(99)).toBe(30_000);
  });

  it("slows nonessential polling only for Save-Data and very slow links", () => {
    expect(lowResourceConnection({ saveData: true })).toBe(true);
    expect(lowResourceConnection({ effectiveType: "2g" })).toBe(true);
    expect(lowResourceConnection({ effectiveType: "4g" })).toBe(false);
    expect(gamePollingIntervalMs({ effectiveType: "4g" })).toBe(3_000);
    expect(gamePollingIntervalMs({ saveData: true })).toBe(9_000);
  });

  it("aborts a stalled read and releases its timer", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(
          new DOMException("Aborted", "AbortError"),
        ));
      }),
    );
    try {
      const request = fetchWithReadTimeout("/slow", {}, 50);
      const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("forwards a caller abort signal", async () => {
    const caller = new AbortController();
    let receivedSignal: AbortSignal | null = null;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) => new Promise((_resolve, reject) => {
        receivedSignal = init?.signal ?? null;
        init?.signal?.addEventListener("abort", () => reject(
          new DOMException("Aborted", "AbortError"),
        ));
      }),
    );
    try {
      const request = fetchWithReadTimeout("/cancelled", { signal: caller.signal });
      caller.abort();
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect((receivedSignal as AbortSignal | null)?.aborted).toBe(true);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("keeps the deadline active while the JSON response body is read", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | null = null;
    const response = new Response("pending", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    vi.spyOn(response, "json").mockImplementation(() => new Promise(() => undefined));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) => {
        receivedSignal = init?.signal ?? null;
        return response;
      },
    );
    try {
      const request = fetchJsonWithReadTimeout("/slow-body", {}, 50);
      const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      expect((receivedSignal as AbortSignal | null)?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("aborts a stalled JSON body when its caller is cancelled", async () => {
    const caller = new AbortController();
    const response = new Response("pending", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    vi.spyOn(response, "json").mockImplementation(() => new Promise(() => undefined));
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    try {
      const request = fetchJsonWithReadTimeout("/cancelled-body", {
        signal: caller.signal,
      });
      caller.abort();
      await expect(request).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("returns both response metadata and parsed JSON", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      JSON.stringify({ ready: true }),
      { status: 202, headers: { "content-type": "application/json" } },
    ));
    try {
      const result = await fetchJsonWithReadTimeout<{ ready: boolean }>("/ready");
      expect(result.response.status).toBe(202);
      expect(result.data).toEqual({ ready: true });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("returns null without parsing a legitimate no-content response", async () => {
    const response = new Response(null, { status: 204 });
    const json = vi.spyOn(response, "json");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    try {
      const result = await fetchJsonWithReadTimeout<{ ready: boolean }>("/unchanged");
      expect(result.response.status).toBe(204);
      expect(result.data).toBeNull();
      expect(json).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });
});
