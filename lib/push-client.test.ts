import { describe, expect, it } from "vitest";
import {
  applicationServerKeyBytes,
  browserPushPayload,
  pushEndpointHash,
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

  it("derives a stable, non-reversible endpoint identifier", async () => {
    await expect(pushEndpointHash("https://fcm.googleapis.com/example"))
      .resolves.toBe("23da70500a1e3948fb76ffc0473ef7fe371563a2b7c1264c696f3caaae5e79a8");
  });
});
