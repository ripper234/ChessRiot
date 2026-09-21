export const PUSH_DIAGNOSTIC_RECEIPT_TYPE = "chessriot:push-diagnostic-receipt";
export const PUSH_DIAGNOSTIC_WORKER_VERSION_REQUEST_TYPE = "chessriot:push-worker-version-request";
export const PUSH_DIAGNOSTIC_WORKER_VERSION_RESPONSE_TYPE = "chessriot:push-worker-version-response";
export const PUSH_DIAGNOSTIC_WORKER_VERSION = "0.29.1";
export const LOCAL_PUSH_DIAGNOSTIC_EVENT_TYPE = "chessriot:local-push-diagnostic-event";
export const LOCAL_PUSH_DIAGNOSTIC_TAG_PREFIX = "chessriot-local-diagnostic-v1:";
export const PUSH_DIAGNOSTIC_RECEIPT_TIMEOUT_MS = 15_000;
export const PUSH_DIAGNOSTIC_WORKER_READY_TIMEOUT_MS = 10_000;
const PUSH_DIAGNOSTIC_TERMINAL_GRACE_MS = 250;

export type PushDiagnosticReceiptStage =
  | "push_received"
  | "show_resolved"
  | "show_rejected"
  | "notification_active"
  | "notification_missing"
  | "notification_clicked"
  | "notification_closed";

const PUSH_DIAGNOSTIC_RECEIPT_STAGES = new Set<PushDiagnosticReceiptStage>([
  "push_received",
  "show_resolved",
  "show_rejected",
  "notification_active",
  "notification_missing",
  "notification_clicked",
  "notification_closed",
]);

const IMMEDIATE_PUSH_DIAGNOSTIC_STAGES = new Set<PushDiagnosticReceiptStage>([
  "show_rejected",
  "notification_active",
  "notification_clicked",
]);

const DEFERRED_PUSH_DIAGNOSTIC_STAGES = new Set<PushDiagnosticReceiptStage>([
  "notification_missing",
  "notification_closed",
]);

export type LocalPushDiagnosticResult = "active" | "clicked" | "closed" | "missing";

interface ServiceWorkerMessageSource {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

export interface PushDiagnosticReceiptResult {
  stages: PushDiagnosticReceiptStage[];
  timedOut: boolean;
  cancelled: boolean;
}

export interface PushDiagnosticReceiptWaiter {
  wait(timeoutMs?: number): Promise<PushDiagnosticReceiptResult>;
  cancel(): void;
}

function isPushDiagnosticReceiptStage(value: unknown): value is PushDiagnosticReceiptStage {
  return typeof value === "string"
    && PUSH_DIAGNOSTIC_RECEIPT_STAGES.has(value as PushDiagnosticReceiptStage);
}

export function createPushDiagnosticReceiptWaiter(
  source: ServiceWorkerMessageSource,
  notificationId: string,
): PushDiagnosticReceiptWaiter {
  const stages = new Set<PushDiagnosticReceiptStage>();
  let waiting = false;
  let settled = false;
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let resolveWait: ((result: PushDiagnosticReceiptResult) => void) | null = null;

  const snapshot = (timedOut: boolean, cancelled: boolean): PushDiagnosticReceiptResult => ({
    stages: [...stages],
    timedOut,
    cancelled,
  });
  const detach = () => {
    if (timer !== null) globalThis.clearTimeout(timer);
    timer = null;
    source.removeEventListener("message", onMessage);
  };
  const finish = (timedOut: boolean, cancelled: boolean) => {
    if (settled) return;
    settled = true;
    detach();
    resolveWait?.(snapshot(timedOut, cancelled));
  };
  const hasImmediateStage = () => [...stages].some(
    (stage) => IMMEDIATE_PUSH_DIAGNOSTIC_STAGES.has(stage),
  );
  const hasDeferredStage = () => [...stages].some(
    (stage) => DEFERRED_PUSH_DIAGNOSTIC_STAGES.has(stage),
  );
  const settleFromStages = () => {
    if (!waiting) return;
    if (hasImmediateStage()) {
      finish(false, false);
      return;
    }
    if (hasDeferredStage()) {
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = globalThis.setTimeout(
        () => finish(false, false),
        PUSH_DIAGNOSTIC_TERMINAL_GRACE_MS,
      );
    }
  };
  const onMessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (
      !data
      || typeof data !== "object"
      || (data as { type?: unknown }).type !== PUSH_DIAGNOSTIC_RECEIPT_TYPE
      || (data as { notificationId?: unknown }).notificationId !== notificationId
      || !isPushDiagnosticReceiptStage((data as { stage?: unknown }).stage)
    ) return;
    const stage = (data as { stage: PushDiagnosticReceiptStage }).stage;
    if (stages.has(stage)) return;
    stages.add(stage);
    settleFromStages();
  };

  source.addEventListener("message", onMessage);
  return {
    wait(timeoutMs = PUSH_DIAGNOSTIC_RECEIPT_TIMEOUT_MS) {
      if (waiting) {
        throw new Error("The notification receipt wait already started.");
      }
      waiting = true;
      return new Promise<PushDiagnosticReceiptResult>((resolve) => {
        resolveWait = resolve;
        if (hasImmediateStage() || hasDeferredStage()) {
          settleFromStages();
          return;
        }
        timer = globalThis.setTimeout(
          () => finish(true, false),
          Math.max(0, timeoutMs),
        );
      });
    },
    cancel() {
      if (settled) return;
      if (waiting) {
        finish(false, true);
      } else {
        settled = true;
        detach();
      }
    },
  };
}

function waitForDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The notification test was cancelled.", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("The notification test was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function requestPushWorkerVersion(
  worker: ServiceWorker,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    const finish = (version: string | null) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      channel.port1.close();
      resolve(version);
    };
    const onAbort = () => finish(null);
    const timer = globalThis.setTimeout(() => finish(null), Math.max(0, timeoutMs));
    channel.port1.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      finish(
        data
        && typeof data === "object"
        && (data as { type?: unknown }).type === PUSH_DIAGNOSTIC_WORKER_VERSION_RESPONSE_TYPE
        && typeof (data as { version?: unknown }).version === "string"
          ? (data as { version: string }).version
          : null,
      );
    };
    channel.port1.start();
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      finish(null);
      return;
    }
    try {
      worker.postMessage({ type: PUSH_DIAGNOSTIC_WORKER_VERSION_REQUEST_TYPE }, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

export async function ensureCurrentPushDiagnosticWorker(
  registration: ServiceWorkerRegistration,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  let updateFailed = false;
  try {
    await registration.update();
  } catch {
    updateFailed = true;
  }
  const timeoutMs = options.timeoutMs ?? PUSH_DIAGNOSTIC_WORKER_READY_TIMEOUT_MS;
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (Date.now() <= deadline) {
    if (options.signal?.aborted) {
      throw new DOMException("The notification test was cancelled.", "AbortError");
    }
    const active = registration.active;
    if (active?.state === "activated") {
      const remaining = Math.max(0, deadline - Date.now());
      const version = await requestPushWorkerVersion(
        active,
        Math.min(750, remaining),
        options.signal,
      );
      if (version === PUSH_DIAGNOSTIC_WORKER_VERSION) return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await waitForDelay(Math.min(150, remaining), options.signal);
  }
  throw new Error(updateFailed
    ? "ChessRiot could not check the notification worker update. Reload this tab and retry the test."
    : "ChessRiot is still using an older notification worker. Reload this tab and retry the test.");
}

export async function registerLocalPushDiagnostic(
  registration: ServiceWorkerRegistration,
  notificationId: string,
  source: ServiceWorkerMessageSource,
  locale: "en" | "he" = "en",
): Promise<LocalPushDiagnosticResult> {
  let lifecycle: Exclude<LocalPushDiagnosticResult, "active" | "missing"> | null = null;
  let resolveLifecycle: ((result: "clicked" | "closed") => void) | null = null;
  const lifecyclePromise = new Promise<"clicked" | "closed">((resolve) => {
    resolveLifecycle = resolve;
  });
  const onMessage = (event: MessageEvent) => {
    const data: unknown = event.data;
    if (
      !data
      || typeof data !== "object"
      || (data as { type?: unknown }).type !== LOCAL_PUSH_DIAGNOSTIC_EVENT_TYPE
      || (data as { notificationId?: unknown }).notificationId !== notificationId
    ) return;
    const stage = (data as { stage?: unknown }).stage;
    if (stage !== "notification_clicked" && stage !== "notification_closed") return;
    lifecycle = stage === "notification_clicked" ? "clicked" : "closed";
    resolveLifecycle?.(lifecycle);
  };
  source.addEventListener("message", onMessage);
  try {
    const previous = await registration.getNotifications();
    for (const notification of previous) {
      if (notification.tag.startsWith(LOCAL_PUSH_DIAGNOSTIC_TAG_PREFIX)) {
        notification.close();
      }
    }
    const tag = `${LOCAL_PUSH_DIAGNOSTIC_TAG_PREFIX}${notificationId}`;
    await registration.showNotification("ChessRiot", {
      body: locale === "he"
        ? "בדיקת התראה מקומית מהדפדפן הזה."
        : "Local notification test from this browser.",
      tag,
      requireInteraction: true,
      data: { path: "/app", localDiagnosticId: notificationId },
    });
    const notifications = await registration.getNotifications({ tag });
    if (notifications.some((notification) => notification.tag === tag)) return "active";
    if (lifecycle) return lifecycle;
    return await Promise.race<LocalPushDiagnosticResult>([
      lifecyclePromise,
      new Promise<"missing">((resolve) => {
        globalThis.setTimeout(() => resolve("missing"), PUSH_DIAGNOSTIC_TERMINAL_GRACE_MS);
      }),
    ]);
  } finally {
    source.removeEventListener("message", onMessage);
  }
}

export function pushPresentationRecoveryMessage(input: {
  brave: boolean;
  mobile: boolean;
  windows: boolean;
  locale?: "en" | "he";
}): string {
  if (input.locale === "he") {
    if (input.mobile) {
      return input.brave
        ? "בדקו את הגדרות ההתראות של Brave ושל הטלפון, כולל שירותי Google להעברת הודעות Push."
        : "בדקו את הגדרות ההתראות בדפדפן ובטלפון.";
    }
    if (input.windows) {
      return `אם ההתראה לא הופיעה, ${input.brave ? "ייתכן ש־Brave או Windows מסתירים אותה" : "ייתכן שהדפדפן או Windows מסתירים אותה"}. פתחו הגדרות Windows ← מערכת ← התראות, הפעילו ${input.brave ? "Brave Browser" : "את הדפדפן הזה"} ואת באנרי ההתראות, וכבו את מצב 'נא לא להפריע'.`;
    }
    return "אם ההתראה לא הופיעה, ייתכן שהדפדפן או מערכת ההפעלה מסתירים אותה. בדקו את הגדרות ההתראות ואת מצב 'נא לא להפריע'.";
  }
  if (input.mobile) {
    return input.brave
      ? "Check Brave and phone notification settings, including Google services for push messaging."
      : "Check this browser and your phone’s notification settings.";
  }
  if (input.windows) {
    return `If you did not see it, ${input.brave ? "Brave or Windows may be suppressing its presentation" : "the browser or Windows may be suppressing its presentation"}. Open Windows Settings → System → Notifications, enable ${input.brave ? "Brave Browser" : "this browser"} and notification banners, then turn off Do Not Disturb.`;
  }
  return "If you did not see it, the browser or operating system may be suppressing its presentation. Check system notification and Do Not Disturb settings.";
}
