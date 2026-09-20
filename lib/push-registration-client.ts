import { requestHeaders } from "./client-http";
import { generateUuid } from "./client-storage";
import {
  applicationServerKeyBytes,
  browserPushPayload,
  setPushConsentEnabled,
  subscriptionUsesApplicationServerKey,
} from "./push-client";
import {
  recordNotificationPermissionAttempt,
  synchronizeTerminalNotificationPermission,
} from "./notification-permission";
import {
  PushSetupError,
  pushSetupHttpError,
  runPushSetupStage,
} from "./push-setup";

const PUSH_REGISTRATION_LOCK = "chessriot-push-registration-v1";
const SERVICE_WORKER_READY_TIMEOUT_MS = 10_000;

let registrationInFlight: {
  operation: Promise<PushSubscription>;
  expectedUsername: string;
  publicKey: string;
} | null = null;

export async function preparePushServiceWorker(): Promise<ServiceWorkerRegistration> {
  const registration = await runPushSetupStage(
    "service_worker",
    () => navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    }),
  );
  if (registration.active) return registration;
  return await runPushSetupStage(
    "service_worker",
    () => new Promise<ServiceWorkerRegistration>((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        const error = new Error("The service worker did not become ready.");
        error.name = "TimeoutError";
        reject(error);
      }, SERVICE_WORKER_READY_TIMEOUT_MS);
      void navigator.serviceWorker.ready.then(
        (ready) => {
          globalThis.clearTimeout(timeout);
          resolve(ready);
        },
        (error) => {
          globalThis.clearTimeout(timeout);
          reject(error);
        },
      );
    }),
  );
}

async function performPushRegistration(input: {
  registration: ServiceWorkerRegistration;
  publicKey: string;
  expectedUsername: string;
}): Promise<PushSubscription> {
  if (Notification.permission === "default") {
    recordNotificationPermissionAttempt("started");
  }
  let subscription: PushSubscription;
  try {
    subscription = await runPushSetupStage(
      "subscription_create",
      () => input.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKeyBytes(input.publicKey),
      }),
    );
  } catch (initialError) {
    const existing = await runPushSetupStage(
      "subscription_read",
      () => input.registration.pushManager.getSubscription(),
    );
    if (!existing) throw initialError;
    const existingExpired = existing.expirationTime !== null
      && existing.expirationTime <= Date.now();
    if (!existingExpired && subscriptionUsesApplicationServerKey(existing, input.publicKey)) {
      subscription = existing;
    } else {
      const removed = await runPushSetupStage(
        "subscription_replace",
        () => existing.unsubscribe(),
      );
      if (!removed) throw new PushSetupError("subscription_replace", "invalid_state");
      subscription = await runPushSetupStage(
        "subscription_create",
        () => input.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKeyBytes(input.publicKey),
        }),
      );
    }
  } finally {
    synchronizeTerminalNotificationPermission(Notification.permission);
  }
  const saveSubscription = async (current: PushSubscription): Promise<Response> => {
    const payload = browserPushPayload(current);
    if (!payload) throw new PushSetupError("subscription_serialize", "invalid_response");
    return await runPushSetupStage(
      "server_register",
      () => fetch("/api/me/push-devices", {
        method: "PUT",
        credentials: "same-origin",
        headers: requestHeaders(null, true),
        keepalive: true,
        body: JSON.stringify({
          requestId: generateUuid(),
          expectedUsername: input.expectedUsername,
          subscription: payload,
        }),
      }),
    );
  };
  const isStaleSubscriptionResponse = async (response: Response): Promise<boolean> => {
    if (response.status !== 409) return false;
    try {
      const payload = await response.clone().json() as { error?: { code?: unknown } };
      return payload.error?.code === "stale_subscription";
    } catch {
      return false;
    }
  };
  let preserveStaleAudit = false;
  try {
    let response = await saveSubscription(subscription);
    if (await isStaleSubscriptionResponse(response)) {
      preserveStaleAudit = true;
      const removed = await runPushSetupStage(
        "subscription_replace",
        () => subscription.unsubscribe(),
      );
      if (!removed) throw new PushSetupError("subscription_replace", "invalid_state");
      subscription = await runPushSetupStage(
        "subscription_create",
        () => input.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKeyBytes(input.publicKey),
        }),
      );
      response = await saveSubscription(subscription);
    }
    if (!response.ok) throw pushSetupHttpError("server_register", response.status);
    response.body?.cancel();
    return subscription;
  } catch (error) {
    if (preserveStaleAudit) {
      await subscription.unsubscribe().catch(() => false);
    } else {
      await unregisterPushDevice({
        subscription,
        expectedUsername: input.expectedUsername,
      }).catch(() => undefined);
    }
    throw error;
  }
}

export function registerPushDevice(input: {
  registration: ServiceWorkerRegistration;
  publicKey: string;
  expectedUsername: string;
}): Promise<PushSubscription> {
  if (registrationInFlight) {
    if (
      registrationInFlight.expectedUsername === input.expectedUsername
      && registrationInFlight.publicKey === input.publicKey
    ) {
      return registrationInFlight.operation;
    }
    return Promise.reject(new PushSetupError("subscription_create", "invalid_state"));
  }
  const lockManager = navigator.locks;
  const pending: Promise<PushSubscription> = lockManager && Notification.permission !== "default"
    ? lockManager.request<Promise<PushSubscription>>(
      PUSH_REGISTRATION_LOCK,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) throw new PushSetupError("subscription_create", "invalid_state");
        return await performPushRegistration(input);
      },
    ).then((result) => result)
    : performPushRegistration(input);
  const operation = pending.finally(() => {
    if (registrationInFlight?.operation === operation) registrationInFlight = null;
  });
  registrationInFlight = {
    operation,
    expectedUsername: input.expectedUsername,
    publicKey: input.publicKey,
  };
  return operation;
}

export async function unregisterPushDevice(input: {
  subscription: PushSubscription;
  expectedUsername: string;
}): Promise<void> {
  const payload = browserPushPayload(input.subscription);
  try {
    if (payload) {
      const response = await fetch("/api/me/push-devices", {
        method: "DELETE",
        credentials: "same-origin",
        headers: requestHeaders(null, true),
        keepalive: true,
        body: JSON.stringify({
          requestId: generateUuid(),
          expectedUsername: input.expectedUsername,
          endpoint: payload.endpoint,
        }),
      });
      if (!response.ok) throw pushSetupHttpError("server_register", response.status);
      response.body?.cancel();
    }
  } finally {
    await input.subscription.unsubscribe().catch(() => false);
  }
}

export async function settlePushRegistrationChoice(
  input: {
    subscription: PushSubscription;
    expectedUsername: string;
    isCancelled: () => boolean;
  },
  runtime: {
    setConsent: (enabled: boolean, expectedUsername?: string) => Promise<void>;
    unregister: (input: {
      subscription: PushSubscription;
      expectedUsername: string;
    }) => Promise<void>;
  } = {
    setConsent: (enabled, expectedUsername) => enabled
      ? setPushConsentEnabled(true, expectedUsername ?? "")
      : setPushConsentEnabled(false),
    unregister: unregisterPushDevice,
  },
): Promise<"enabled" | "cancelled"> {
  const revoke = async () => {
    try {
      await runtime.setConsent(false);
    } finally {
      await runtime.unregister({
        subscription: input.subscription,
        expectedUsername: input.expectedUsername,
      }).catch(() => undefined);
    }
  };
  if (input.isCancelled()) {
    await revoke();
    return "cancelled";
  }
  try {
    await runtime.setConsent(true, input.expectedUsername);
  } catch (error) {
    await revoke();
    throw error;
  }
  if (input.isCancelled()) {
    await revoke();
    return "cancelled";
  }
  return "enabled";
}
