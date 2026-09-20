import { describe, expect, it, vi } from "vitest";
import {
  applicationServerKeyBytes,
  browserPushPayload,
  pushEndpointHash,
  PUSH_CONSENT_DESIRED_KEY,
  setPushConsentEnabled,
  subscriptionUsesApplicationServerKey,
} from "./push-client";

describe("push client helpers", () => {
  it("decodes a URL-safe application server key", () => {
    expect(Array.from(applicationServerKeyBytes("AAECA_7_")))
      .toEqual([0, 1, 2, 3, 254, 255]);
  });

  it("serializes only complete browser subscriptions", () => {
    const complete = {
      expirationTime: null,
      toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/fcm/send/example",
        keys: { p256dh: "public-key", auth: "auth-key" },
      }),
    } as unknown as PushSubscription;
    expect(browserPushPayload(complete)).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/example",
      expirationTime: null,
      keys: { p256dh: "public-key", auth: "auth-key" },
    });

    const incomplete = {
      expirationTime: null,
      toJSON: () => ({ endpoint: "https://example.com" }),
    } as unknown as PushSubscription;
    expect(browserPushPayload(incomplete)).toBeNull();
  });

  it("recognizes whether a subscription belongs to the configured server key", () => {
    const matching = {
      options: {
        applicationServerKey: applicationServerKeyBytes("AAECA_7_").buffer,
      },
    } as unknown as PushSubscription;
    expect(subscriptionUsesApplicationServerKey(matching, "AAECA_7_")).toBe(true);
    expect(subscriptionUsesApplicationServerKey(matching, "AAECA_7-"))
      .toBe(false);

    const missing = {
      options: { applicationServerKey: null },
    } as unknown as PushSubscription;
    expect(subscriptionUsesApplicationServerKey(missing, "AAECA_7_")).toBe(false);
  });

  it("derives a stable, non-reversible endpoint identifier", async () => {
    await expect(pushEndpointHash("https://fcm.googleapis.com/example"))
      .resolves.toBe("23da70500a1e3948fb76ffc0473ef7fe371563a2b7c1264c696f3caaae5e79a8");
  });

  it("replays the latest consent after a delayed older write", async () => {
    const values = new Map<string, string>();
    let releaseEnable: () => void = () => undefined;
    const delayedEnable = new Promise<void>((resolve) => {
      releaseEnable = resolve;
    });
    const cache = {
      put: vi.fn((request: RequestInfo | URL, response: Response) => {
        void request;
        void response;
        return delayedEnable;
      }),
      delete: vi.fn(async () => true),
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
    try {
      const enable = setPushConsentEnabled(true, "alice");
      await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));
      const disable = setPushConsentEnabled(false);
      await disable;
      expect(cache.delete).toHaveBeenCalledTimes(1);
      releaseEnable();
      await enable;
      await vi.waitFor(() => expect(cache.delete).toHaveBeenCalledTimes(2));
      const enabledPayload = JSON.parse(await (cache.put.mock.calls[0]?.[1] as Response).text());
      expect(enabledPayload).toMatchObject({ version: 2, username: "alice" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("repairs a delayed write after another tab records newer consent", async () => {
    const values = new Map<string, string>();
    let releaseEnable: () => void = () => undefined;
    const cache = {
      put: vi.fn((request: RequestInfo | URL, response: Response) => {
        void request;
        void response;
        return new Promise<void>((resolve) => {
          releaseEnable = resolve;
        });
      }),
      delete: vi.fn(async () => true),
    };
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal("caches", { open: vi.fn(async () => cache) });
    try {
      const enable = setPushConsentEnabled(true, "alice");
      await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(1));
      values.set(PUSH_CONSENT_DESIRED_KEY, JSON.stringify({
        token: "newer-tab",
        enabled: false,
        username: null,
      }));
      releaseEnable();
      await enable;
      await vi.waitFor(() => expect(cache.delete).toHaveBeenCalledTimes(1));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never lets Cache Storage block the caller", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("caches", { open: () => new Promise(() => undefined) });
    try {
      const operation = setPushConsentEnabled(false);
      await vi.advanceTimersByTimeAsync(1_500);
      await expect(operation).resolves.toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
