import { describe, expect, it, vi } from "vitest";
import {
  claimBrowserNotificationOnboarding,
  claimNotificationOnboarding,
  completedNotificationOnboardingDecision,
  createNotificationPermissionCoordinator,
  NOTIFICATION_ONBOARDING_SEEN_KEY,
  NOTIFICATION_PERMISSION_ATTEMPT_KEY,
  notificationDecisionKeepsPushSubscription,
  notificationPermissionWasAttempted,
  pushSubscriptionNeedsReplacement,
  resumableNotificationDecision,
  shouldAttemptNotificationPermission,
  shouldEnterNotificationPermissionFlow,
  shouldRepairPushSubscription,
  synchronizeTerminalNotificationPermission,
} from "./notification-permission";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("device notification permission attempt", () => {
  it("is eligible only once while browser permission is undecided", () => {
    expect(shouldAttemptNotificationPermission({
      supported: true,
      permission: "default",
      attempted: false,
    })).toBe(true);
    expect(shouldAttemptNotificationPermission({
      supported: true,
      permission: "default",
      attempted: true,
    })).toBe(false);
    expect(shouldAttemptNotificationPermission({
      supported: true,
      permission: "granted",
      attempted: false,
    })).toBe(false);
    expect(shouldAttemptNotificationPermission({
      supported: false,
      permission: "unsupported",
      attempted: false,
    })).toBe(false);
  });

  it("never re-enters the optional gate after it was shown or permission resolved", () => {
    expect(shouldEnterNotificationPermissionFlow({
      supported: true,
      permission: "granted",
      attempted: true,
      accountDecision: "setup-pending",
      onboardingSeen: true,
    })).toBe(false);
    expect(shouldEnterNotificationPermissionFlow({
      supported: true,
      permission: "granted",
      attempted: true,
      accountDecision: "onboarding",
      onboardingSeen: true,
    })).toBe(false);
    expect(shouldEnterNotificationPermissionFlow({
      supported: true,
      permission: "default",
      attempted: false,
      accountDecision: "dismissed",
      onboardingSeen: true,
    })).toBe(false);
    expect(shouldEnterNotificationPermissionFlow({
      supported: true,
      permission: "default",
      attempted: false,
      accountDecision: "disabled",
      onboardingSeen: false,
    })).toBe(false);
    expect(shouldEnterNotificationPermissionFlow({
      supported: true,
      permission: "default",
      attempted: false,
      accountDecision: null,
      onboardingSeen: false,
    })).toBe(true);
  });

  it("claims the optional ask once for a retained browser profile", () => {
    const storage = new MemoryStorage();
    expect(claimNotificationOnboarding(storage)).toBe(true);
    expect(storage.getItem(NOTIFICATION_ONBOARDING_SEEN_KEY)).toBe("shown");
    expect(claimNotificationOnboarding(storage)).toBe(false);
  });

  it("fails open when the browser lock never resolves", async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("navigator", {
      locks: { request: () => new Promise<boolean>(() => undefined) },
    });
    try {
      const claim = claimBrowserNotificationOnboarding();
      await vi.advanceTimersByTimeAsync(500);
      await expect(claim).resolves.toBe(false);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("preserves an in-progress subscription during focus reconciliation", () => {
    expect(notificationDecisionKeepsPushSubscription("onboarding")).toBe(true);
    expect(notificationDecisionKeepsPushSubscription("setup-pending")).toBe(true);
    expect(notificationDecisionKeepsPushSubscription("setup-failed")).toBe(true);
    expect(notificationDecisionKeepsPushSubscription("enabled")).toBe(true);
    expect(notificationDecisionKeepsPushSubscription(null)).toBe(false);
    expect(notificationDecisionKeepsPushSubscription("dismissed")).toBe(false);
    expect(notificationDecisionKeepsPushSubscription("disabled")).toBe(false);
  });

  it("repairs a missing opted-in subscription without reopening permission", () => {
    expect(shouldRepairPushSubscription({
      permission: "granted",
      accountDecision: "enabled",
      hasSubscription: false,
    })).toBe(true);
    expect(shouldRepairPushSubscription({
      permission: "granted",
      accountDecision: "setup-failed",
      hasSubscription: false,
    })).toBe(true);
    expect(shouldRepairPushSubscription({
      permission: "granted",
      accountDecision: "enabled",
      hasSubscription: true,
    })).toBe(false);
    expect(shouldRepairPushSubscription({
      permission: "default",
      accountDecision: "enabled",
      hasSubscription: false,
    })).toBe(false);
    expect(shouldRepairPushSubscription({
      permission: "granted",
      accountDecision: "disabled",
      hasSubscription: false,
    })).toBe(false);
  });

  it("replaces expired and provider-stale subscriptions", () => {
    expect(pushSubscriptionNeedsReplacement({
      expirationTime: 999,
      serverStale: false,
      nowMs: 1_000,
    })).toBe(true);
    expect(pushSubscriptionNeedsReplacement({
      expirationTime: null,
      serverStale: true,
      nowMs: 1_000,
    })).toBe(true);
    expect(pushSubscriptionNeedsReplacement({
      expirationTime: 1_001,
      serverStale: false,
      nowMs: 1_000,
    })).toBe(false);
    expect(pushSubscriptionNeedsReplacement({
      expirationTime: null,
      serverStale: false,
      nowMs: 1_000,
    })).toBe(false);
  });

  it("resumes the crash window after the browser granted permission", () => {
    expect(resumableNotificationDecision("granted", "onboarding"))
      .toBe("setup-pending");
    expect(resumableNotificationDecision("default", "onboarding"))
      .toBe("onboarding");
    expect(resumableNotificationDecision("granted", "dismissed"))
      .toBe("dismissed");
  });

  it("does not let a stale onboarding card overwrite a concurrent Settings choice", () => {
    expect(completedNotificationOnboardingDecision("enabled", "dismissed"))
      .toBe("enabled");
    expect(completedNotificationOnboardingDecision("setup-pending", "dismissed"))
      .toBe("setup-pending");
    expect(completedNotificationOnboardingDecision("onboarding", "dismissed"))
      .toBe("dismissed");
  });

  it("coalesces local callers and never repeats the automatic request", async () => {
    const storage = new MemoryStorage();
    let resolvePermission: (permission: NotificationPermission) => void = () => undefined;
    const requestPermission = vi.fn(() => new Promise<NotificationPermission>((resolve) => {
      resolvePermission = resolve;
    }));
    const coordinator = createNotificationPermissionCoordinator({
      readPermission: () => "default",
      requestPermission,
      storage,
    });

    const first = coordinator.requestAutomatic();
    const concurrent = coordinator.requestAutomatic();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(storage.getItem(NOTIFICATION_PERMISSION_ATTEMPT_KEY)).toBe("started");
    resolvePermission("default");
    expect(await first).toEqual({ attempted: true, permission: "default", failed: false });
    expect(await concurrent).toEqual({ attempted: true, permission: "default", failed: false });

    expect(await coordinator.requestAutomatic()).toEqual({
      attempted: false,
      permission: "default",
      failed: false,
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent tabs before sharing the device marker", async () => {
    const storage = new MemoryStorage();
    const firstRequest = vi.fn(async () => "denied" as const);
    const secondRequest = vi.fn(async () => "granted" as const);
    let lockTail: Promise<unknown> = Promise.resolve();
    const runAutomaticExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
      const result = lockTail.then(operation, operation);
      lockTail = result.then(() => undefined, () => undefined);
      return result;
    };
    const firstAccount = createNotificationPermissionCoordinator({
      readPermission: () => "default",
      requestPermission: firstRequest,
      storage,
      runAutomaticExclusive,
    });
    const secondAccount = createNotificationPermissionCoordinator({
      readPermission: () => "default",
      requestPermission: secondRequest,
      storage,
      runAutomaticExclusive,
    });

    await Promise.all([
      firstAccount.requestAutomatic(),
      secondAccount.requestAutomatic(),
    ]);
    expect(firstRequest).toHaveBeenCalledTimes(1);
    expect(secondRequest).not.toHaveBeenCalled();
  });

  it("records an existing terminal browser decision without requesting again", async () => {
    const storage = new MemoryStorage();
    const requestPermission = vi.fn(async () => "granted" as const);
    synchronizeTerminalNotificationPermission("denied", storage);
    expect(notificationPermissionWasAttempted(storage)).toBe(true);

    const coordinator = createNotificationPermissionCoordinator({
      readPermission: () => "denied",
      requestPermission,
      storage,
    });
    expect(await coordinator.requestAutomatic()).toEqual({
      attempted: false,
      permission: "denied",
      failed: false,
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("burns a failed automatic attempt but keeps a manual Settings retry", async () => {
    const storage = new MemoryStorage();
    const requestPermission = vi.fn()
      .mockRejectedValueOnce(new Error("browser rejected the request"))
      .mockResolvedValueOnce("granted");
    const coordinator = createNotificationPermissionCoordinator({
      readPermission: () => "default",
      requestPermission,
      storage,
    });

    expect(await coordinator.requestAutomatic()).toEqual({
      attempted: true,
      permission: "default",
      failed: true,
    });
    await coordinator.requestAutomatic();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(await coordinator.requestManual()).toEqual({
      attempted: true,
      permission: "granted",
      failed: false,
    });
    expect(requestPermission).toHaveBeenCalledTimes(2);
  });
});
