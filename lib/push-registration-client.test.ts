import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_PERMISSION_ATTEMPT_KEY } from "./notification-permission";
import {
  registerPushDevice,
  settlePushRegistrationChoice,
  unregisterPushDevice,
} from "./push-registration-client";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("explicit push-device registration", () => {
  it("creates and saves the browser subscription in one serialized transaction", async () => {
    const applicationKey = new Uint8Array(65);
    applicationKey[0] = 4;
    applicationKey.fill(7, 1);
    const publicKey = base64Url(applicationKey);
    const storage = new MemoryStorage();
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/client-registration",
      expirationTime: null,
      options: { applicationServerKey: applicationKey.buffer },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/client-registration",
        keys: {
          p256dh: base64Url(applicationKey),
          auth: base64Url(new Uint8Array(16).fill(11)),
        },
      }),
      unsubscribe: vi.fn(async () => true),
    } as unknown as PushSubscription;
    let permission: NotificationPermission = "default";
    const subscribe = vi.fn(async () => {
      permission = "granted";
      return subscription;
    });
    const getSubscription = vi.fn(async () => null);
    const registration = {
      pushManager: {
        getSubscription,
        subscribe,
      },
    } as unknown as ServiceWorkerRegistration;
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return new Response(
        JSON.stringify({ enabled: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("window", { localStorage: storage });
    vi.stubGlobal("Notification", {
      get permission() {
        return permission;
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {
      locks: {
        request: vi.fn(() => Promise.reject(new Error("A default-permission setup must not wait for a lock"))),
      },
    });

    await expect(registerPushDevice({
      registration,
      publicKey,
      expectedUsername: "ripper234",
    })).resolves.toBe(subscription);

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(getSubscription).not.toHaveBeenCalled();
    expect(storage.getItem(NOTIFICATION_PERMISSION_ATTEMPT_KEY)).toBe("granted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("PUT");
    expect(init?.keepalive).toBe(true);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      expectedUsername: "ripper234",
      subscription: { endpoint: subscription.endpoint },
    });
  });

  it("recreates a missing subscription after permission was already granted", async () => {
    const applicationKey = Uint8Array.from([4, ...new Uint8Array(64).fill(7)]);
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/repaired-registration",
      expirationTime: null,
      options: { applicationServerKey: applicationKey.buffer },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/repaired-registration",
        keys: {
          p256dh: base64Url(applicationKey),
          auth: base64Url(new Uint8Array(16).fill(11)),
        },
      }),
      unsubscribe: vi.fn(async () => true),
    } as unknown as PushSubscription;
    const subscribe = vi.fn(async () => subscription);
    const registration = {
      pushManager: {
        subscribe,
        getSubscription: vi.fn(async () => null),
      },
    } as unknown as ServiceWorkerRegistration;
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return new Response(null, { status: 200 });
    });
    const requestLock = vi.fn(async (
      _name: string,
      _options: LockOptions,
      operation: (lock: Lock | null) => Promise<PushSubscription>,
    ) => await operation({ name: "chessriot-push-registration-v1", mode: "exclusive" }));
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", { locks: { request: requestLock } });
    vi.stubGlobal("fetch", fetchMock);

    await expect(registerPushDevice({
      registration,
      publicKey: base64Url(applicationKey),
      expectedUsername: "ripper234",
    })).resolves.toBe(subscription);

    expect(requestLock).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
  });

  it("shares a same-owner repair across overlapping reconciliation passes", async () => {
    const applicationKey = Uint8Array.from([4, ...new Uint8Array(64).fill(7)]);
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/shared-repair",
      expirationTime: null,
      options: { applicationServerKey: applicationKey.buffer },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/shared-repair",
        keys: {
          p256dh: base64Url(applicationKey),
          auth: base64Url(new Uint8Array(16).fill(11)),
        },
      }),
      unsubscribe: vi.fn(async () => true),
    } as unknown as PushSubscription;
    let finishSubscribe: () => void = () => undefined;
    const subscribe = vi.fn(() => new Promise<PushSubscription>((resolve) => {
      finishSubscribe = () => resolve(subscription);
    }));
    const registration = {
      pushManager: {
        subscribe,
        getSubscription: vi.fn(async () => null),
      },
    } as unknown as ServiceWorkerRegistration;
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    const requestLock = vi.fn(async (
      _name: string,
      _options: LockOptions,
      operation: (lock: Lock | null) => Promise<PushSubscription>,
    ) => await operation({ name: "chessriot-push-registration-v1", mode: "exclusive" }));
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
    vi.stubGlobal("Notification", { permission: "granted" });
    vi.stubGlobal("navigator", { locks: { request: requestLock } });
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      registration,
      publicKey: base64Url(applicationKey),
      expectedUsername: "ripper234",
    };
    const first = registerPushDevice(input);
    const second = registerPushDevice(input);
    expect(second).toBe(first);
    finishSubscribe();

    await expect(Promise.all([first, second])).resolves.toEqual([subscription, subscription]);
    expect(requestLock).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("replaces an expired matching subscription instead of adopting it", async () => {
    const applicationKey = Uint8Array.from([4, ...new Uint8Array(64).fill(7)]);
    const expired = {
      endpoint: "https://fcm.googleapis.com/fcm/send/expired",
      expirationTime: Date.now() - 1,
      options: { applicationServerKey: applicationKey.buffer },
      unsubscribe: vi.fn(async () => true),
    } as unknown as PushSubscription;
    const fresh = {
      endpoint: "https://fcm.googleapis.com/fcm/send/fresh",
      expirationTime: null,
      options: { applicationServerKey: applicationKey.buffer },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/fresh",
        keys: {
          p256dh: base64Url(applicationKey),
          auth: base64Url(new Uint8Array(16).fill(11)),
        },
      }),
      unsubscribe: vi.fn(async () => true),
    } as unknown as PushSubscription;
    const subscribe = vi.fn()
      .mockRejectedValueOnce(new DOMException("Existing subscription", "InvalidStateError"))
      .mockResolvedValueOnce(fresh);
    const registration = {
      pushManager: {
        subscribe,
        getSubscription: vi.fn(async () => expired),
      },
    } as unknown as ServiceWorkerRegistration;
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
    vi.stubGlobal("Notification", { permission: "default" });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));

    await expect(registerPushDevice({
      registration,
      publicKey: base64Url(applicationKey),
      expectedUsername: "ripper234",
    })).resolves.toBe(fresh);
    expect(expired.unsubscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it("replaces a provider-stale subscription without deleting its server audit parent", async () => {
    const applicationKey = Uint8Array.from([4, ...new Uint8Array(64).fill(7)]);
    const subscription = (suffix: string) => ({
      endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
      expirationTime: null,
      options: { applicationServerKey: applicationKey.buffer },
      toJSON: () => ({
        endpoint: `https://fcm.googleapis.com/fcm/send/${suffix}`,
        keys: {
          p256dh: base64Url(applicationKey),
          auth: base64Url(new Uint8Array(16).fill(suffix === "stale" ? 11 : 12)),
        },
      }),
      unsubscribe: vi.fn(async () => true),
    }) as unknown as PushSubscription;
    const stale = subscription("stale");
    const fresh = subscription("fresh");
    const subscribe = vi.fn()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(fresh);
    const registration = {
      pushManager: {
        subscribe,
        getSubscription: vi.fn(async () => null),
      },
    } as unknown as ServiceWorkerRegistration;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: "stale_subscription" },
      }), { status: 409, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
    vi.stubGlobal("Notification", { permission: "default" });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchMock);

    await expect(registerPushDevice({
      registration,
      publicKey: base64Url(applicationKey),
      expectedUsername: "ripper234",
    })).resolves.toBe(fresh);
    expect(stale.unsubscribe).toHaveBeenCalledOnce();
    expect(fresh.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["PUT", "PUT"]);
  });

  it("removes the server row and browser subscription when a late setup is skipped", async () => {
    const unsubscribe = vi.fn(async () => true);
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/late-registration",
      expirationTime: null,
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/late-registration",
        keys: {
          p256dh: base64Url(Uint8Array.from([4, ...new Uint8Array(64).fill(7)])),
          auth: base64Url(new Uint8Array(16).fill(11)),
        },
      }),
      unsubscribe,
    } as unknown as PushSubscription;
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return new Response(JSON.stringify({ enabled: false }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await unregisterPushDevice({ subscription, expectedUsername: "ripper234" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("DELETE");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      expectedUsername: "ripper234",
      endpoint: subscription.endpoint,
    });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("adopts a matching subscription left behind by an aborted subscribe promise", async () => {
    const applicationKey = Uint8Array.from([4, ...new Uint8Array(64).fill(7)]);
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/late-success",
      expirationTime: null,
      options: { applicationServerKey: applicationKey.buffer },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/late-success",
        keys: {
          p256dh: base64Url(applicationKey),
          auth: base64Url(new Uint8Array(16).fill(11)),
        },
      }),
      unsubscribe: vi.fn(async () => true),
    } as unknown as PushSubscription;
    const aborted = new DOMException("Subscription completed after caller abort", "AbortError");
    const registration = {
      pushManager: {
        subscribe: vi.fn(async () => { throw aborted; }),
        getSubscription: vi.fn(async () => subscription),
      },
    } as unknown as ServiceWorkerRegistration;
    const fetchMock = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      void args;
      return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    });
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
    vi.stubGlobal("Notification", { permission: "default" });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchMock);

    await expect(registerPushDevice({
      registration,
      publicKey: base64Url(applicationKey),
      expectedUsername: "ripper234",
    })).resolves.toBe(subscription);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });

  it("revokes a browser subscription when server registration is rejected", async () => {
    const applicationKey = Uint8Array.from([4, ...new Uint8Array(64).fill(7)]);
    const unsubscribe = vi.fn(async () => true);
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/rejected-registration",
      expirationTime: null,
      options: { applicationServerKey: applicationKey.buffer },
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/rejected-registration",
        keys: {
          p256dh: base64Url(applicationKey),
          auth: base64Url(new Uint8Array(16).fill(11)),
        },
      }),
      unsubscribe,
    } as unknown as PushSubscription;
    const registration = {
      pushManager: {
        subscribe: vi.fn(async () => subscription),
        getSubscription: vi.fn(async () => null),
      },
    } as unknown as ServiceWorkerRegistration;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: false }), { status: 200 }));
    vi.stubGlobal("window", { localStorage: new MemoryStorage() });
    vi.stubGlobal("Notification", { permission: "default" });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("fetch", fetchMock);

    await expect(registerPushDevice({
      registration,
      publicKey: base64Url(applicationKey),
      expectedUsername: "ripper234",
    })).rejects.toMatchObject({ stage: "server_register", kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("keeps Not now authoritative when it wins during consent persistence", async () => {
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/cancelled",
    } as PushSubscription;
    let cancelled = false;
    const consentWrites: boolean[] = [];
    const unregister = vi.fn(async () => undefined);
    const result = await settlePushRegistrationChoice({
      subscription,
      expectedUsername: "ripper234",
      isCancelled: () => cancelled,
    }, {
      setConsent: async (enabled) => {
        consentWrites.push(enabled);
        if (enabled) cancelled = true;
      },
      unregister,
    });

    expect(result).toBe("cancelled");
    expect(consentWrites).toEqual([true, false]);
    expect(unregister).toHaveBeenCalledOnce();
    expect(unregister).toHaveBeenCalledWith({
      subscription,
      expectedUsername: "ripper234",
    });
  });
});
