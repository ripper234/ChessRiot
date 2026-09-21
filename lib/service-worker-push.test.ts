import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { turnTestReceiptOpened, type TurnTestReceipt } from "./notification-turn-test-client";

interface WorkerEvent {
  data?: unknown;
  ports?: Array<{ postMessage(message: unknown): void }>;
  notification?: {
    data?: {
      path?: unknown;
      diagnosticId?: unknown;
      localDiagnosticId?: unknown;
      gameVersion?: unknown;
      testGameId?: unknown;
    };
    close(): void;
  };
  waitUntil?(promise: Promise<unknown>): void;
}

type WorkerListener = (event: WorkerEvent) => void;

const listeners = new Map<string, WorkerListener>();
const diagnosticCache = new Map<string, Response>();
interface RetainedNotification {
  tag: string;
  data: Record<string, unknown>;
  close(): void;
}
const retainedNotifications = new Map<string, RetainedNotification>();
const showNotification = vi.fn(async (
  _title: string,
  options: { tag?: string; data?: Record<string, unknown> },
) => {
  if (!options.tag) return;
  const tag = options.tag;
  retainedNotifications.set(tag, {
    tag,
    data: options.data ?? {},
    close: () => {
      retainedNotifications.delete(tag);
    },
  });
});
const getNotifications = vi.fn(async ({ tag }: { tag?: string } = {}) => (
  [...retainedNotifications.values()].filter((notification) => !tag || notification.tag === tag)
));
const postMessage = vi.fn();
const focus = vi.fn(async () => undefined);
const client = {
  postMessage,
  url: "https://dev.chessriot.gg/app",
  visibilityState: "visible",
  focus,
};
const matchAll = vi.fn(async () => [client]);
const openWindow = vi.fn<(path: string) => Promise<undefined>>(async () => undefined);

beforeEach(() => {
  listeners.clear();
  diagnosticCache.clear();
  retainedNotifications.clear();
  showNotification.mockClear();
  getNotifications.mockClear();
  postMessage.mockClear();
  focus.mockClear();
  matchAll.mockClear();
  openWindow.mockReset();
  const worker = {
    location: { origin: "https://dev.chessriot.gg" },
    registration: { showNotification, getNotifications },
    clients: { matchAll, openWindow },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (type: string, listener: WorkerListener) => {
      listeners.set(type, listener);
    },
  };
  runInNewContext(
    readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8"),
    {
      self: worker,
      caches: { open: async () => ({
        match: async (path: string) => diagnosticCache.get(path)?.clone(),
        put: async (path: string, response: Response) => { diagnosticCache.set(path, response.clone()); },
        keys: async () => [...diagnosticCache.keys()],
        delete: async (path: string) => diagnosticCache.delete(path),
      }) },
      fetch: vi.fn(),
      URL,
      Uint8Array,
      atob,
      Promise,
      Response,
      Request,
      JSON,
      Array,
      RegExp,
      String,
    },
  );
});

function beginPush(payload: unknown): Promise<unknown> {
  const listener = listeners.get("push");
  if (!listener) throw new Error("Push listener was not installed");
  let completion: Promise<unknown> = Promise.resolve();
  listener({
    data: { json: () => payload },
    waitUntil: (promise) => {
      completion = Promise.resolve(promise);
    },
  } as WorkerEvent);
  return completion;
}

async function dispatchPush(payload: unknown): Promise<void> {
  await beginPush(payload);
}

async function viewGame(gameId: string, gameVersion: number): Promise<void> {
  let completion: Promise<unknown> = Promise.resolve();
  listeners.get("message")?.({
    data: { type: "clear-turn-notification", gameId, gameVersion },
    waitUntil: (promise) => { completion = promise; },
  });
  await completion;
}

describe("service-worker push display", () => {
  it("keeps real-turn evidence with every app window closed, then records an exact-game tap", async () => {
    const gameId = "123e4567-e89b-42d3-a456-426614174000";
    matchAll.mockResolvedValueOnce([]);
    await dispatchPush({ type: "your_turn", gameId, gameVersion: 2, notificationTest: true });
    const path = `/__chessriot_turn_test__/${gameId}/2`;
    const receipt = await diagnosticCache.get(path)?.clone().json() as Record<string, unknown>;
    expect(receipt).toMatchObject({ visibleClients: 0, receivedAt: expect.any(Number), shownAt: expect.any(Number) });
    expect(receipt.clickedAt).toBeUndefined();
    expect(showNotification).toHaveBeenCalledWith("ChessRiot", expect.objectContaining({
      data: { path: `/g/${gameId}`, gameVersion: 2, testGameId: gameId },
    }));
    matchAll.mockResolvedValueOnce([]);
    let completion: Promise<unknown> = Promise.resolve();
    listeners.get("notificationclick")?.({
      notification: { data: { path: `/g/${gameId}`, gameVersion: 2, testGameId: gameId }, close: vi.fn() },
      waitUntil: (promise) => { completion = promise; },
    });
    await completion;
    expect(openWindow).toHaveBeenCalledWith(`/g/${gameId}`);
    expect(await diagnosticCache.get(path)?.clone().json()).toMatchObject({ clickedAt: expect.any(Number), shownAt: expect.any(Number) });
  });

  it("cannot turn a foreground first receipt into a hidden receipt by redelivering it", async () => {
    const gameId = "123e4567-e89b-42d3-a456-426614174000";
    matchAll.mockResolvedValueOnce([client]);
    await dispatchPush({ type: "your_turn", gameId, gameVersion: 2, notificationTest: true });
    matchAll.mockResolvedValueOnce([]);
    await dispatchPush({ type: "your_turn", gameId, gameVersion: 2, notificationTest: true });
    expect(await diagnosticCache.get(`/__chessriot_turn_test__/${gameId}/2`)?.clone().json()).toMatchObject({ visibleClients: 1 });
  });

  it("records a rejected Android presentation without claiming a display", async () => {
    const gameId = "123e4567-e89b-42d3-a456-426614174000";
    matchAll.mockResolvedValueOnce([]);
    showNotification.mockRejectedValueOnce(new Error("display blocked"));
    await expect(dispatchPush({ type: "your_turn", gameId, gameVersion: 4, notificationTest: true })).rejects.toThrow("display blocked");
    const receipt = await diagnosticCache.get(`/__chessriot_turn_test__/${gameId}/4`)?.clone().json() as Record<string, unknown>;
    expect(receipt.showRejectedAt).toEqual(expect.any(Number));
    expect(receipt.shownAt).toBeUndefined();
  });

  it.each(["enumerate", "focus", "navigate-focus"])(
    "opens the exact game when an existing client fails at %s",
    async (failure) => {
      const path = "/g/11111111-1111-4111-8111-111111111111";
      if (failure === "enumerate") {
        matchAll.mockRejectedValueOnce(new Error("client disappeared"));
      } else {
        const brokenFocus = vi.fn(async () => { throw new Error("cannot focus"); });
        matchAll.mockResolvedValueOnce([{
          ...client,
          url: `https://dev.chessriot.gg${failure === "focus" ? path : "/app"}`,
          focus: brokenFocus,
          ...(failure === "navigate-focus"
            ? { navigate: async () => ({ focus: brokenFocus }) }
            : {}),
        }]);
      }
      let completion = Promise.resolve();
      listeners.get("notificationclick")!({
        notification: { data: { path }, close: vi.fn() },
        waitUntil: (promise) => { completion = promise as Promise<void>; },
      });
      await completion;
      expect(openWindow).toHaveBeenCalledWith(path);
    },
  );

  it("shows a turn alert with a fixed title and game route", async () => {
    const gameId = "11111111-1111-4111-8111-111111111111";
    await dispatchPush({
      type: "your_turn",
      gameId,
      gameVersion: 7,
      title: "spoof",
      path: "https://evil.test",
    });
    expect(showNotification).toHaveBeenCalledWith("ChessRiot", expect.objectContaining({
      body: "It’s your turn.",
      tag: `turn-${gameId}`,
      data: { path: `/g/${gameId}`, gameVersion: 7 },
    }));
    expect(showNotification.mock.calls[0]?.[1]).not.toHaveProperty("renotify");
  });

  it("re-alerts a newer turn but not an exact delivery retry", async () => {
    const gameId = "99999999-9999-4999-8999-999999999999";
    await dispatchPush({ type: "your_turn", gameId, gameVersion: 4 });
    await dispatchPush({ type: "your_turn", gameId, gameVersion: 4 });
    expect(showNotification.mock.calls[1]?.[1]).not.toHaveProperty("renotify");

    await dispatchPush({ type: "your_turn", gameId, gameVersion: 6 });
    expect(showNotification.mock.calls[2]?.[1]).toMatchObject({
      tag: `turn-${gameId}`,
      renotify: true,
      data: { path: `/g/${gameId}`, gameVersion: 6 },
    });
  });

  it("does not let an older or unversioned delivery replace a newer retained turn", async () => {
    const gameId = "88888888-8888-4888-8888-888888888888";
    await dispatchPush({ type: "your_turn", gameId, gameVersion: 8 });
    await dispatchPush({ type: "your_turn", gameId, gameVersion: 6 });
    await dispatchPush({ type: "your_turn", gameId });

    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(retainedNotifications.get(`turn-${gameId}`)?.data).toEqual({
      path: `/g/${gameId}`,
      gameVersion: 8,
    });
  });

  it("serializes overlapping same-game versions before deciding which alert to retain", async () => {
    const gameId = "12121212-1212-4121-8121-121212121212";
    let releaseFirstRead: (notifications: RetainedNotification[]) => void = () => {};
    const firstRead = new Promise<RetainedNotification[]>((resolve) => {
      releaseFirstRead = resolve;
    });
    getNotifications.mockImplementationOnce(() => firstRead);

    const older = beginPush({ type: "your_turn", gameId, gameVersion: 6 });
    await Promise.resolve();
    expect(getNotifications).toHaveBeenCalledTimes(1);
    const newer = beginPush({ type: "your_turn", gameId, gameVersion: 8 });
    await Promise.resolve();
    expect(getNotifications).toHaveBeenCalledTimes(1);

    releaseFirstRead([]);
    await Promise.all([older, newer]);
    expect(showNotification).toHaveBeenCalledTimes(2);
    expect(retainedNotifications.get(`turn-${gameId}`)?.data).toEqual({
      path: `/g/${gameId}`,
      gameVersion: 8,
    });
    expect(showNotification.mock.calls[1]?.[1]).toMatchObject({ renotify: true });
  });

  it("preserves current and newer turns on page opening, and clears only an obsolete turn", async () => {
    const gameId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const otherGameId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await dispatchPush({ type: "your_turn", gameId, gameVersion: 8 });
    await dispatchPush({ type: "your_turn", gameId: otherGameId, gameVersion: 2 });
    await viewGame(gameId, 7);
    expect(retainedNotifications.has(`turn-${gameId}`)).toBe(true);
    await viewGame(gameId, 8);
    await viewGame(gameId, 8);
    expect(retainedNotifications.has(`turn-${gameId}`)).toBe(true);
    await viewGame(gameId, 9);
    expect(retainedNotifications.has(`turn-${gameId}`)).toBe(false);
    expect(retainedNotifications.has(`turn-${otherGameId}`)).toBe(true);
  });

  it("keeps a legacy notification until explicitly acknowledged when its age is unknown", async () => {
    const gameId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await dispatchPush({ type: "your_turn", gameId });
    await viewGame(gameId, 10);
    expect(retainedNotifications.has(`turn-${gameId}`)).toBe(true);
  });

  it("lets all four test notifications be tapped after manually reopening the game", async () => {
    const gameId = "123e4567-e89b-42d3-a456-426614174000";
    const tag = `turn-${gameId}`;
    for (const version of [2, 4, 6, 8]) {
      matchAll.mockResolvedValueOnce([]);
      await dispatchPush({ type: "your_turn", gameId, gameVersion: version, notificationTest: true });
      await viewGame(gameId, version - 1);
      await viewGame(gameId, version);
      const notification = retainedNotifications.get(tag);
      expect(notification).toBeDefined();
      const receiptPath = `/__chessriot_turn_test__/${gameId}/${version}`;
      const beforeTap = await diagnosticCache.get(receiptPath)?.clone().json() as TurnTestReceipt;
      expect(beforeTap.clickedAt).toBeUndefined();
      expect(turnTestReceiptOpened(beforeTap)).toBe(false);
      matchAll.mockResolvedValueOnce([{ ...client, url: `https://dev.chessriot.gg/g/${gameId}` }]);
      let completion: Promise<unknown> = Promise.resolve();
      listeners.get("notificationclick")?.({
        notification,
        waitUntil: (promise) => { completion = promise; },
      });
      await completion;
      expect(retainedNotifications.has(tag)).toBe(false);
      const afterTap = await diagnosticCache.get(receiptPath)?.clone().json() as TurnTestReceipt;
      expect(afterTap).toMatchObject({ clickedAt: expect.any(Number), visibleClients: 0 });
      expect(turnTestReceiptOpened({ ...afterTap, openedAt: Date.now() })).toBe(true);
    }
    expect(focus).toHaveBeenCalledTimes(4);
    expect(showNotification).toHaveBeenCalledTimes(4);
  });

  it("shows a friend request and deep-links to the Activity inbox", async () => {
    const requestId = "22222222-2222-4222-8222-222222222222";
    await dispatchPush({ type: "friend_request", senderUsername: "ripper234", requestId });
    expect(showNotification).toHaveBeenCalledWith("ChessRiot", expect.objectContaining({
      body: "@ripper234 sent you a friend request.",
      tag: `friend-request-${requestId}`,
      data: { path: "/?activity=1" },
    }));
  });

  it("shows bounded service text and rejects malformed payloads", async () => {
    await dispatchPush({
      type: "service",
      body: "Server delivery test: ChessRiot reached this device.",
      notificationId: "1234567890abcdef",
      title: "spoof",
      path: "https://evil.test",
    });
    expect(showNotification).toHaveBeenCalledWith("ChessRiot", expect.objectContaining({
      body: "Server delivery test: ChessRiot reached this device.",
      icon: "/icons/chessriot-192.png",
      requireInteraction: true,
      data: { path: "/app" },
    }));
    showNotification.mockClear();
    await dispatchPush({ type: "service", body: "line one\nline two" });
    await dispatchPush({ type: "friend_request", senderUsername: "spoof\u202eexe", requestId: crypto.randomUUID() });
    await dispatchPush({ type: "unknown", body: "hello" });
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("acknowledges an exact device test only after registering its notification", async () => {
    const diagnosticId = "33333333-3333-4333-8333-333333333333";
    await dispatchPush({
      type: "service",
      body: "Server delivery test: ChessRiot reached this device.",
      notificationId: diagnosticId,
      diagnosticId,
    });
    expect(showNotification).toHaveBeenCalledWith("ChessRiot", expect.objectContaining({
      tag: `service-${diagnosticId}`,
      icon: "/icons/chessriot-192.png",
      requireInteraction: true,
      data: { path: "/app", diagnosticId },
    }));
    expect(matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
    expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
      {
        type: "chessriot:push-diagnostic-receipt",
        notificationId: diagnosticId,
        stage: "push_received",
      },
      {
        type: "chessriot:push-diagnostic-receipt",
        notificationId: diagnosticId,
        stage: "show_resolved",
      },
      {
        type: "chessriot:push-diagnostic-receipt",
        notificationId: diagnosticId,
        stage: "notification_active",
      },
    ]);
  });

  it("reports notification API rejection after browser receipt", async () => {
    const diagnosticId = "66666666-6666-4666-8666-666666666666";
    showNotification.mockRejectedValueOnce(new Error("blocked"));
    await expect(dispatchPush({
      type: "service",
      body: "Server delivery test: ChessRiot reached this device.",
      notificationId: diagnosticId,
      diagnosticId,
    })).rejects.toThrow("blocked");
    expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
      expect.objectContaining({ notificationId: diagnosticId, stage: "push_received" }),
      expect.objectContaining({ notificationId: diagnosticId, stage: "show_rejected" }),
    ]);
  });

  it("reports a click for the exact diagnostic notification", async () => {
    const diagnosticId = "77777777-7777-4777-8777-777777777777";
    const listener = listeners.get("notificationclick");
    if (!listener) throw new Error("Notification click listener was not installed");
    let completion: Promise<unknown> | null = null;
    listener({
      notification: {
        data: { path: "/app", diagnosticId },
        close: vi.fn(),
      },
      waitUntil: (promise) => {
        completion = Promise.resolve(promise);
      },
    });
    if (completion) await completion;
    expect(postMessage).toHaveBeenCalledWith({
      type: "chessriot:push-diagnostic-receipt",
      notificationId: diagnosticId,
      stage: "notification_clicked",
    });
    expect(focus).toHaveBeenCalledOnce();
  });

  it("reports a fast local diagnostic click on its separate channel", async () => {
    const diagnosticId = "88888888-8888-4888-8888-888888888888";
    const listener = listeners.get("notificationclick");
    if (!listener) throw new Error("Notification click listener was not installed");
    let completion: Promise<unknown> | null = null;
    listener({
      notification: {
        data: { path: "/app", localDiagnosticId: diagnosticId },
        close: vi.fn(),
      },
      waitUntil: (promise) => {
        completion = Promise.resolve(promise);
      },
    });
    if (completion) await completion;
    expect(postMessage).toHaveBeenCalledWith({
      type: "chessriot:local-push-diagnostic-event",
      notificationId: diagnosticId,
      stage: "notification_clicked",
    });
  });

  it("reports its diagnostic protocol version through a message port", () => {
    const listener = listeners.get("message");
    if (!listener) throw new Error("Message listener was not installed");
    const reply = vi.fn();
    listener({
      data: { type: "chessriot:push-worker-version-request" },
      ports: [{ postMessage: reply }],
    });
    expect(reply).toHaveBeenCalledWith({
      type: "chessriot:push-worker-version-response",
      version: "0.30.1",
    });
  });

  it("does not acknowledge a forged or mismatched diagnostic marker", async () => {
    await dispatchPush({
      type: "service",
      body: "Server delivery test: ChessRiot reached this device.",
      notificationId: "44444444-4444-4444-8444-444444444444",
      diagnosticId: "55555555-5555-4555-8555-555555555555",
    });
    expect(showNotification).toHaveBeenCalledTimes(1);
    expect(matchAll).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
