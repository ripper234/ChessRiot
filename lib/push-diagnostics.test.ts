import { describe, expect, it, vi } from "vitest";
import {
  createPushDiagnosticReceiptWaiter,
  ensureCurrentPushDiagnosticWorker,
  LOCAL_PUSH_DIAGNOSTIC_EVENT_TYPE,
  LOCAL_PUSH_DIAGNOSTIC_TAG_PREFIX,
  PUSH_DIAGNOSTIC_RECEIPT_TYPE,
  PUSH_DIAGNOSTIC_WORKER_VERSION,
  PUSH_DIAGNOSTIC_WORKER_VERSION_RESPONSE_TYPE,
  pushPresentationRecoveryMessage,
  registerLocalPushDiagnostic,
} from "./push-diagnostics";

class MessageSource {
  readonly listeners = new Set<(event: MessageEvent) => void>();

  addEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  dispatch(data: unknown): void {
    for (const listener of this.listeners) listener({ data } as MessageEvent);
  }
}

describe("push diagnostics", () => {
  it("confirms that Brave retained the local persistent notification", async () => {
    const showNotification = vi.fn(async () => undefined);
    const close = vi.fn();
    const tag = `${LOCAL_PUSH_DIAGNOSTIC_TAG_PREFIX}expected`;
    const registration = {
      showNotification,
      getNotifications: vi.fn()
        .mockResolvedValueOnce([{
          tag: `${LOCAL_PUSH_DIAGNOSTIC_TAG_PREFIX}old`,
          close,
        }])
        .mockResolvedValueOnce([{ tag }]),
    } as unknown as ServiceWorkerRegistration;

    const source = new MessageSource();
    await expect(registerLocalPushDiagnostic(
      registration,
      "expected",
      source,
    )).resolves.toBe("active");
    expect(close).toHaveBeenCalledOnce();
    expect(showNotification).toHaveBeenCalledWith("ChessRiot", expect.objectContaining({
      tag,
      requireInteraction: true,
    }));
  });

  it("distinguishes a fast local close from a missing notification", async () => {
    const source = new MessageSource();
    const registration = {
      showNotification: vi.fn(async () => {
        queueMicrotask(() => source.dispatch({
          type: LOCAL_PUSH_DIAGNOSTIC_EVENT_TYPE,
          notificationId: "expected",
          stage: "notification_closed",
        }));
      }),
      getNotifications: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    } as unknown as ServiceWorkerRegistration;

    await expect(registerLocalPushDiagnostic(
      registration,
      "expected",
      source,
    )).resolves.toBe("closed");
  });

  it("does not confuse an unrelated service-worker message with receipt", async () => {
    vi.useFakeTimers();
    try {
      const source = new MessageSource();
      const waiter = createPushDiagnosticReceiptWaiter(source, "expected");
      source.dispatch({
        type: PUSH_DIAGNOSTIC_RECEIPT_TYPE,
        notificationId: "other",
        stage: "notification_active",
      });
      const result = waiter.wait(1_000);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(result).resolves.toEqual({
        stages: [],
        timedOut: true,
        cancelled: false,
      });
      expect(source.listeners.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("buffers early stages and starts its timeout only when wait begins", async () => {
    vi.useFakeTimers();
    try {
      const source = new MessageSource();
      const waiter = createPushDiagnosticReceiptWaiter(source, "expected");
      await vi.advanceTimersByTimeAsync(5_000);
      source.dispatch({
        type: PUSH_DIAGNOSTIC_RECEIPT_TYPE,
        notificationId: "expected",
        stage: "push_received",
      });
      const result = waiter.wait(1_000);
      await vi.advanceTimersByTimeAsync(999);
      let settled = false;
      void result.then(() => { settled = true; });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual({
        stages: ["push_received"],
        timedOut: true,
        cancelled: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the exact staged server-push receipt", async () => {
    const source = new MessageSource();
    const waiter = createPushDiagnosticReceiptWaiter(source, "expected");
    source.dispatch({
      type: PUSH_DIAGNOSTIC_RECEIPT_TYPE,
      notificationId: "expected",
      stage: "push_received",
    });
    source.dispatch({
      type: PUSH_DIAGNOSTIC_RECEIPT_TYPE,
      notificationId: "expected",
      stage: "show_resolved",
    });
    source.dispatch({
      type: PUSH_DIAGNOSTIC_RECEIPT_TYPE,
      notificationId: "expected",
      stage: "notification_active",
    });
    await expect(waiter.wait(1_000)).resolves.toEqual({
      stages: ["push_received", "show_resolved", "notification_active"],
      timedOut: false,
      cancelled: false,
    });
    expect(source.listeners.size).toBe(0);
  });

  it("finishes promptly when the worker reports a missing notification", async () => {
    vi.useFakeTimers();
    try {
      const source = new MessageSource();
      const waiter = createPushDiagnosticReceiptWaiter(source, "expected");
      const result = waiter.wait(15_000);
      source.dispatch({
        type: PUSH_DIAGNOSTIC_RECEIPT_TYPE,
        notificationId: "expected",
        stage: "notification_missing",
      });
      await vi.advanceTimersByTimeAsync(250);
      await expect(result).resolves.toEqual({
        stages: ["notification_missing"],
        timedOut: false,
        cancelled: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("confirms the active worker protocol after checking for an update", async () => {
    const update = vi.fn(async () => undefined);
    const worker = {
      state: "activated",
      postMessage: vi.fn((_message: unknown, ports: Transferable[]) => {
        const port = ports[0] as MessagePort;
        port.postMessage({
          type: PUSH_DIAGNOSTIC_WORKER_VERSION_RESPONSE_TYPE,
          version: PUSH_DIAGNOSTIC_WORKER_VERSION,
        });
      }),
    } as unknown as ServiceWorker;
    const registration = {
      active: worker,
      update,
    } as unknown as ServiceWorkerRegistration;

    await expect(ensureCurrentPushDiagnosticWorker(registration, {
      timeoutMs: 1_000,
    })).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledOnce();
  });

  it("gives cautious desktop Windows guidance instead of Android guidance", () => {
    const message = pushPresentationRecoveryMessage({
      brave: true,
      mobile: false,
      windows: true,
    });
    expect(message).toContain("Brave or Windows may be suppressing its presentation");
    expect(message).toContain("Windows Settings → System → Notifications");
    expect(message).not.toContain("Android");
  });

  it("provides native Hebrew presentation recovery copy when requested", () => {
    const message = pushPresentationRecoveryMessage({
      brave: false,
      mobile: true,
      windows: false,
      locale: "he",
    });
    expect(message).toContain("הגדרות ההתראות");
    expect(message).not.toContain("Check");
  });
});
