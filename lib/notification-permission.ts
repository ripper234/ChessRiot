export const NOTIFICATION_PERMISSION_ATTEMPT_KEY =
  "chessriot:notification-permission-attempt:v1";
export const NOTIFICATION_ONBOARDING_SEEN_KEY =
  "chessriot:notification-onboarding-seen:v1";
export const NOTIFICATION_SETUP_REQUESTED_EVENT =
  "chessriot:notification-setup-requested";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export interface NotificationPermissionAttempt {
  attempted: boolean;
  permission: NotificationPermission;
  failed: boolean;
}

interface PermissionRuntime {
  readPermission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  storage: StorageLike | null;
  runAutomaticExclusive?: (
    operation: () => Promise<NotificationPermissionAttempt>,
  ) => Promise<NotificationPermissionAttempt>;
}

const NOTIFICATION_PERMISSION_LOCK = "chessriot-notification-permission-v1";
const NOTIFICATION_ONBOARDING_LOCK = "chessriot-notification-onboarding-v1";
const NOTIFICATION_ONBOARDING_LOCK_TIMEOUT_MS = 500;

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function browserRuntime(): PermissionRuntime {
  const lockManager = typeof navigator === "undefined" ? undefined : navigator.locks;
  return {
    readPermission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    storage: browserStorage(),
    runAutomaticExclusive: lockManager
      ? async (operation) => {
        const result = await lockManager.request(
          NOTIFICATION_PERMISSION_LOCK,
          { mode: "exclusive" },
          operation,
        );
        return await result;
      }
      : undefined,
  };
}

export function notificationPermissionWasAttempted(
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(NOTIFICATION_PERMISSION_ATTEMPT_KEY) !== null;
  } catch {
    return false;
  }
}

export function notificationOnboardingWasSeen(
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(NOTIFICATION_ONBOARDING_SEEN_KEY) !== null;
  } catch {
    return false;
  }
}

export function claimNotificationOnboarding(
  storage: StorageLike | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(NOTIFICATION_ONBOARDING_SEEN_KEY) !== null) return false;
    storage.setItem(NOTIFICATION_ONBOARDING_SEEN_KEY, "shown");
    return storage.getItem(NOTIFICATION_ONBOARDING_SEEN_KEY) === "shown";
  } catch {
    return false;
  }
}

export async function claimBrowserNotificationOnboarding(): Promise<boolean> {
  const storage = browserStorage();
  if (!storage || notificationOnboardingWasSeen(storage)) return false;
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`;
  const lockManager = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!lockManager) {
    try {
      if (storage.getItem(NOTIFICATION_ONBOARDING_SEEN_KEY) !== null) return false;
      storage.setItem(NOTIFICATION_ONBOARDING_SEEN_KEY, token);
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 50));
      return storage.getItem(NOTIFICATION_ONBOARDING_SEEN_KEY) === token;
    } catch {
      return false;
    }
  }
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const claim = lockManager.request(
      NOTIFICATION_ONBOARDING_LOCK,
      { mode: "exclusive", ifAvailable: true },
      (lock) => Boolean(lock) && claimNotificationOnboarding(storage),
    );
    const timeout = new Promise<false>((resolve) => {
      timer = globalThis.setTimeout(() => resolve(false), NOTIFICATION_ONBOARDING_LOCK_TIMEOUT_MS);
    });
    const result = await Promise.race([claim, timeout]);
    if (timer !== undefined) globalThis.clearTimeout(timer);
    return result;
  } catch {
    return false;
  }
}

export function recordNotificationPermissionAttempt(
  outcome: "started" | NotificationPermission | "failed",
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(NOTIFICATION_PERMISSION_ATTEMPT_KEY, outcome);
  } catch {
    // Browser permission remains authoritative when device storage is unavailable.
  }
}

export function shouldAttemptNotificationPermission(input: {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  attempted: boolean;
}): boolean {
  return input.supported
    && input.permission === "default"
    && !input.attempted;
}

export function shouldEnterNotificationPermissionFlow(input: {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  attempted: boolean;
  accountDecision: string | null;
  onboardingSeen: boolean;
}): boolean {
  if (!input.supported || input.accountDecision === "disabled") return false;
  return !input.onboardingSeen && shouldAttemptNotificationPermission(input);
}

export function notificationDecisionKeepsPushSubscription(
  accountDecision: string | null,
): boolean {
  return accountDecision === "enabled"
    || accountDecision === "onboarding"
    || accountDecision === "setup-pending"
    || accountDecision === "setup-failed";
}

export function recoverNotificationDecision(input: {
  permission: NotificationPermission;
  accountDecision: string | null;
  serverEnabled: boolean;
}): string | null {
  // The account-scoped registry confirms this exact device was opted in.
  // A missing local preference is not an explicit request to revoke it.
  return input.accountDecision === null
    && input.permission === "granted"
    && input.serverEnabled
    ? "enabled"
    : input.accountDecision;
}

export function shouldRepairPushSubscription(input: {
  permission: NotificationPermission;
  accountDecision: string | null;
  hasSubscription: boolean;
}): boolean {
  return input.permission === "granted"
    && notificationDecisionKeepsPushSubscription(input.accountDecision)
    && !input.hasSubscription;
}

export function pushSubscriptionNeedsReplacement(input: {
  expirationTime: number | null;
  serverStale: boolean;
  nowMs?: number;
}): boolean {
  return input.serverStale
    || (input.expirationTime !== null && input.expirationTime <= (input.nowMs ?? Date.now()));
}

export function resumableNotificationDecision(
  permission: NotificationPermission,
  accountDecision: string | null,
): string | null {
  return permission === "granted" && accountDecision === "onboarding"
    ? "setup-pending"
    : accountDecision;
}

export function completedNotificationOnboardingDecision(
  currentDecision: string | null,
  intendedDecision: string,
): string {
  return currentDecision && currentDecision !== "onboarding"
    ? currentDecision
    : intendedDecision;
}

export function synchronizeTerminalNotificationPermission(
  permission: NotificationPermission,
  storage: StorageLike | null = browserStorage(),
): void {
  if (permission !== "default") {
    recordNotificationPermissionAttempt(permission, storage);
  }
}

export function createNotificationPermissionCoordinator(
  runtime: PermissionRuntime,
): {
  requestAutomatic: () => Promise<NotificationPermissionAttempt>;
  requestManual: () => Promise<NotificationPermissionAttempt>;
} {
  let inFlight: Promise<NotificationPermissionAttempt> | null = null;

  const perform = async (automatic: boolean): Promise<NotificationPermissionAttempt> => {
    const current = runtime.readPermission();
    if (current !== "default") {
      recordNotificationPermissionAttempt(current, runtime.storage);
      return { attempted: false, permission: current, failed: false };
    }
    if (automatic && notificationPermissionWasAttempted(runtime.storage)) {
      return { attempted: false, permission: current, failed: false };
    }

    // Claim the one automatic attempt inside the origin-wide exclusive section
    // and before calling the browser API.
    recordNotificationPermissionAttempt("started", runtime.storage);
    try {
      const permission = await runtime.requestPermission();
      recordNotificationPermissionAttempt(permission, runtime.storage);
      return { attempted: true, permission, failed: false };
    } catch {
      recordNotificationPermissionAttempt("failed", runtime.storage);
      return {
        attempted: true,
        permission: runtime.readPermission(),
        failed: true,
      };
    }
  };

  const request = (automatic: boolean): Promise<NotificationPermissionAttempt> => {
    if (inFlight) return inFlight;
    const pending = automatic && runtime.runAutomaticExclusive
      ? runtime.runAutomaticExclusive(() => perform(true))
      : perform(automatic);
    const operation = pending
      .finally(() => {
        if (inFlight === operation) inFlight = null;
      });
    inFlight = operation;
    return operation;
  };

  return {
    requestAutomatic: () => request(true),
    requestManual: () => request(false),
  };
}

let browserCoordinator: ReturnType<typeof createNotificationPermissionCoordinator> | null = null;

export function browserNotificationPermissionCoordinator(): ReturnType<
  typeof createNotificationPermissionCoordinator
> {
  browserCoordinator ??= createNotificationPermissionCoordinator(browserRuntime());
  return browserCoordinator;
}
