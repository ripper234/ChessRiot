import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "https://dev.chessriot.gg";
const GAME_PATH = "/g/123e4567-e89b-42d3-a456-426614174000";
const OTHER_GAME_PATH = "/g/123e4567-e89b-42d3-a456-426614174001";

// Ports deliver asynchronously, like a browser MessageChannel, without requiring
// Node worker-thread handles or depending on their event-loop scheduling.
class TestPort {
  peer!: TestPort;
  closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(data: unknown) {
    queueMicrotask(() => {
      if (!this.peer.closed) this.peer.onmessage?.({ data });
    });
  }
  close() { this.closed = true; }
}
class TestMessageChannel {
  port1 = new TestPort();
  port2 = new TestPort();
  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}

function makeClient(path = OTHER_GAME_PATH) {
  const client = {
    url: `${ORIGIN}${path}`,
    visibilityState: "hidden",
    postMessage: vi.fn<(message: unknown, ports?: TestPort[]) => void>(),
    focus: vi.fn<() => Promise<unknown>>(),
    navigate: vi.fn<(path: string) => Promise<unknown>>(),
  };
  client.focus.mockResolvedValue(client);
  client.navigate.mockResolvedValue(client);
  return client;
}

function makeWorker(clients: ReturnType<typeof makeClient>[] = []) {
  const listeners = new Map<string, (event: unknown) => void>();
  const matchAll = vi.fn(async () => clients);
  const openWindow = vi.fn<(path: string) => Promise<undefined>>(async () => undefined);
  const cacheMatch = vi.fn<() => Promise<Response | undefined>>(async () => undefined);
  const cachePut = vi.fn<(request: Request, response: Response) => Promise<undefined>>(async () => undefined);
  const cacheKeys = vi.fn(async () => [] as Request[]);
  const cacheDelete = vi.fn(async () => true);
  const cacheOpen = vi.fn(async () => ({ put: cachePut, keys: cacheKeys, delete: cacheDelete }));
  const fetch = vi.fn<(request: Request) => Promise<Response>>(
    async () => new Response("network asset"),
  );
  runInNewContext(readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8"), {
    self: {
      location: { origin: ORIGIN },
      clients: { matchAll, openWindow },
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
    },
    caches: { match: cacheMatch, open: cacheOpen },
    fetch, URL, Request, Response, Promise, Uint8Array, atob,
    MessageChannel: TestMessageChannel, setTimeout, clearTimeout, Date,
  });
  return {
    matchAll, openWindow, cacheMatch, cachePut, cacheOpen, fetch,
    click(path = GAME_PATH, data: Record<string, unknown> = {}) {
      const close = vi.fn();
      const lifetime: Promise<unknown>[] = [];
      listeners.get("notificationclick")!({
        notification: { data: { path, ...data }, close },
        waitUntil: (promise: Promise<unknown>) => { lifetime.push(promise); },
      });
      if (!lifetime.length) throw new Error("Notification click did not extend worker lifetime");
      const completion = (async () => {
        await lifetime[0];
        await Promise.all(lifetime.slice(1));
      })();
      return { completion, close };
    },
    request(path: string, method = "GET") {
      const request = new Request(new URL(path, ORIGIN), { method });
      let response: Promise<Response> | undefined;
      const background: Promise<unknown>[] = [];
      listeners.get("fetch")!({
        request,
        respondWith: (promise: Promise<Response>) => { response = promise; },
        waitUntil: (promise: Promise<unknown>) => { background.push(promise); },
      });
      return { request, response, background };
    },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("notification click navigation", () => {
  it("records a click-to-board start timestamp and the observed window category without a position", async () => {
    const clickedAt = 1_800_000_000_000;
    vi.setSystemTime(clickedAt);
    const worker = makeWorker();
    await worker.click(GAME_PATH, { gameVersion: 7 }).completion;
    expect(worker.cacheOpen).toHaveBeenCalledWith("chessriot-notification-timing-v1");
    const [path, response] = worker.cachePut.mock.calls[0];
    expect(path).toBe(`/__chessriot_notification_timing__/${GAME_PATH.slice(3)}`);
    expect(await response.json()).toEqual({ clickedAt, gameVersion: 7, mode: "new-window" });
  });

  it("classifies an existing matching board without a new navigation", async () => {
    const worker = makeWorker([makeClient(GAME_PATH)]);
    await worker.click().completion;
    const [, response] = worker.cachePut.mock.calls[0];
    expect((await response.json() as { mode: string }).mode).toBe("same-game");
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("opens a cold window without waiting for timing storage", async () => {
    const worker = makeWorker();
    let finishWrite!: () => void;
    worker.cachePut.mockImplementation(() => new Promise((resolve) => { finishWrite = () => resolve(undefined); }));
    const click = worker.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(worker.openWindow).toHaveBeenCalledExactlyOnceWith(GAME_PATH);
    finishWrite();
    await click.completion;
  });

  it("focuses an existing board without waiting for timing storage", async () => {
    const client = makeClient(GAME_PATH);
    const worker = makeWorker([client]);
    let finishWrite!: () => void;
    worker.cachePut.mockImplementation(() => new Promise((resolve) => { finishWrite = () => resolve(undefined); }));
    const click = worker.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.focus).toHaveBeenCalledOnce();
    finishWrite();
    await click.completion;
  });

  it("focuses a suspended different-game client before requesting a warm route", async () => {
    const client = makeClient();
    let focused = false;
    client.focus.mockImplementation(async () => { focused = true; return client; });
    client.postMessage.mockImplementation((_message, ports) => {
      // A suspended Android page cannot acknowledge until focus wakes it.
      if (focused) ports?.[0]?.postMessage({ opened: true });
    });
    const worker = makeWorker([client]);
    const click = worker.click();
    await vi.advanceTimersByTimeAsync(0);
    await click.completion;
    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(client.postMessage).toHaveBeenCalledWith(
      { type: "chessriot:notification-open", path: GAME_PATH }, [expect.any(TestPort)],
    );
    expect(client.focus.mock.invocationCallOrder[0]).toBeLessThan(client.postMessage.mock.invocationCallOrder[0]);
    expect(client.navigate).not.toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
    expect(click.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back to exact-game navigation after 300 ms without an acknowledgement", async () => {
    const client = makeClient();
    const worker = makeWorker([client]);
    const click = worker.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.postMessage).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(299);
    expect(client.navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await click.completion;
    expect(client.navigate).toHaveBeenCalledWith(GAME_PATH);
    expect(client.focus).toHaveBeenCalledTimes(2);
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("opens a new exact-game window when warm routing times out and navigation fails", async () => {
    const client = makeClient();
    client.navigate.mockRejectedValue(new Error("Android retired the client"));
    const worker = makeWorker([client]);
    const click = worker.click();
    await vi.advanceTimersByTimeAsync(300);
    await click.completion;
    expect(worker.openWindow).toHaveBeenCalledWith(GAME_PATH);
  });

  it("refreshes and focuses the already-open game without routing or an acknowledgement delay", async () => {
    const client = makeClient(`${GAME_PATH}#key=legacy-seat`);
    const worker = makeWorker([client]);
    await worker.click().completion;
    expect(client.postMessage).toHaveBeenCalledExactlyOnceWith({ type: "chessriot:notification-open", path: GAME_PATH });
    expect(client.focus).toHaveBeenCalledOnce();
    expect(client.navigate).not.toHaveBeenCalled();
    expect(worker.openWindow).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("opens the exact game immediately when no app client exists", async () => {
    const worker = makeWorker();
    await worker.click().completion;
    expect(worker.openWindow).toHaveBeenCalledExactlyOnceWith(GAME_PATH);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["https://other.example/g/abc", `${GAME_PATH}?key=secret`, "/api/me"])(
    "rejects noncanonical notification destinations: %s", async (path) => {
      const worker = makeWorker();
      await worker.click(path).completion;
      expect(worker.openWindow).toHaveBeenCalledExactlyOnceWith("/app");
    },
  );
});

describe("static asset caching", () => {
  it.each(["/assets/app-Abc123_x.js", "/assets/styles-Abc123_x.css", "/assets/font-Abc123_x.woff2", "/_next/static/chunk.js"])(
    "serves a cached immutable asset without another network request: %s", async (path) => {
      const worker = makeWorker();
      const cached = new Response("cached asset");
      worker.cacheMatch.mockResolvedValue(cached);
      const request = worker.request(path);
      expect(await request.response).toBe(cached);
      expect(worker.fetch).not.toHaveBeenCalled();
      expect(request.background).toHaveLength(0);
      expect(worker.cachePut).not.toHaveBeenCalled();
    },
  );

  it("still revalidates an unversioned manifest after serving its cached copy", async () => {
    const worker = makeWorker();
    const cached = new Response("cached manifest");
    worker.cacheMatch.mockResolvedValue(cached);
    const request = worker.request("/manifest.webmanifest");
    expect(await request.response).toBe(cached);
    expect(worker.fetch).toHaveBeenCalledWith(request.request);
    await Promise.all(request.background);
  });

  it.each(["read", "open", "write"] as const)(
    "still serves a valid network asset when Cache Storage %s fails", async (failure) => {
      const worker = makeWorker();
      const error = new Error("Cache Storage unavailable");
      if (failure === "read") worker.cacheMatch.mockRejectedValue(error);
      if (failure === "open") worker.cacheOpen.mockRejectedValue(error);
      if (failure === "write") worker.cachePut.mockRejectedValue(error);
      const request = worker.request("/assets/app-Abc123_x.js");
      const response = await request.response;
      expect(response?.status).toBe(200);
      expect(await response?.text()).toBe("network asset");
      expect(request.background).toHaveLength(0);
      expect(worker.fetch).toHaveBeenCalledOnce();
    },
  );

  it("stores a successful hashed asset without consuming the returned response body", async () => {
    const worker = makeWorker();
    const request = worker.request("/assets/app-Abc123_x.js");
    expect(await (await request.response)?.text()).toBe("network asset");
    expect(request.background).toHaveLength(0);
    expect(worker.cachePut).toHaveBeenCalledOnce();
    expect(worker.cachePut.mock.calls[0][0]).toBe(request.request);
    expect(await worker.cachePut.mock.calls[0][1].text()).toBe("network asset");
  });

  it("does not persist failed asset responses", async () => {
    const worker = makeWorker();
    worker.fetch.mockResolvedValue(new Response("missing", { status: 404 }));
    const request = worker.request("/assets/app-Abc123_x.js");
    expect((await request.response)?.status).toBe(404);
    expect(request.background).toHaveLength(0);
    expect(worker.cacheOpen).not.toHaveBeenCalled();
    expect(worker.cachePut).not.toHaveBeenCalled();
  });

  it.each([
    "/", "/app", GAME_PATH, "/index.html", "/api/auth/session", "/api/me",
    `/api/games/${GAME_PATH.slice(3)}`, "/assets/app.js", "/assets/app-Abc123_x.html",
    "https://external.example/assets/app-Abc123_x.js",
  ])("does not intercept or cache private, HTML, unhashed, or external requests: %s", (path) => {
    const worker = makeWorker();
    const request = worker.request(path);
    expect(request.response).toBeUndefined();
    expect(request.background).toHaveLength(0);
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.cacheMatch).not.toHaveBeenCalled();
    expect(worker.cacheOpen).not.toHaveBeenCalled();
  });

  it("does not cache non-GET requests even when the path looks like a static asset", () => {
    const worker = makeWorker();
    const request = worker.request("/assets/app-Abc123_x.js", "POST");
    expect(request.response).toBeUndefined();
    expect(worker.fetch).not.toHaveBeenCalled();
    expect(worker.cacheMatch).not.toHaveBeenCalled();
  });
});
