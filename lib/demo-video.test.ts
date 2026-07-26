import { afterEach, describe, expect, it } from "vitest";
import {
  authorizeDemoVideoRequest,
  DEMO_VIDEO_CAPTIONS,
  DEMO_VIDEO_DURATION_SECONDS,
  DEMO_VIDEO_MAX_BYTES,
  DEMO_VIDEO_NARRATION,
  demoVideoCanonicalRequest,
} from "./demo-video";

async function signedRequest(timestamp = Date.now()) {
  const jobId = "11111111-1111-4111-8111-111111111111";
  const nonce = "22222222-2222-4222-8222-222222222222";
  const encodedTimestamp = String(timestamp);
  const canonical = demoVideoCanonicalRequest(
    "narration",
    jobId,
    encodedTimestamp,
    nonce,
    "",
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("unit-test-video-secret"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonical),
  ));
  const signature = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return new Request("https://dev.example/api/demo-video/narration", {
    method: "POST",
    headers: {
      "x-demo-video-job": jobId,
      "x-demo-video-timestamp": encodedTimestamp,
      "x-demo-video-nonce": nonce,
      "x-demo-video-signature": signature,
    },
  });
}

describe("demo video contract", () => {
  afterEach(() => {
    globalThis.__CHESSRIOT_ENV__ = undefined;
    globalThis.__CHESSRIOT_VIDEO_REGEN_SHARED_SECRET__ = undefined;
  });

  it("keeps the explainer at the requested length", () => {
    expect(DEMO_VIDEO_DURATION_SECONDS).toBe(90);
  });

  it("uses a fixed narration that does not advertise active Magic Rules", () => {
    expect(DEMO_VIDEO_NARRATION).toContain("Magic Rules are coming soon");
    expect(DEMO_VIDEO_NARRATION).not.toContain("AI coach");
    expect(DEMO_VIDEO_NARRATION).not.toContain("rewards");
  });

  it("ships captions through the final frame", () => {
    expect(DEMO_VIDEO_CAPTIONS).toMatch(/^WEBVTT/);
    expect(DEMO_VIDEO_CAPTIONS).toContain("00:01:29.500");
  });

  it("keeps browser uploads bounded", () => {
    expect(DEMO_VIDEO_MAX_BYTES).toBe(45 * 1024 * 1024);
  });

  it("binds every signed request field into the canonical message", () => {
    expect(demoVideoCanonicalRequest(
      "publish",
      "job",
      "123",
      "nonce",
      "100\n90\nvideo/webm\nsha256",
    )).toBe(
      "chessriot-demo-v1\npublish\njob\n123\nnonce\n100\n90\nvideo/webm\nsha256",
    );
  });

  it("accepts fresh signed mutations in Development only", async () => {
    globalThis.__CHESSRIOT_ENV__ = "development";
    globalThis.__CHESSRIOT_VIDEO_REGEN_SHARED_SECRET__ =
      "unit-test-video-secret";
    await expect(authorizeDemoVideoRequest(
      await signedRequest(),
      "narration",
      "",
    )).resolves.toMatchObject({
      jobId: "11111111-1111-4111-8111-111111111111",
    });

    globalThis.__CHESSRIOT_ENV__ = "production";
    await expect(authorizeDemoVideoRequest(
      await signedRequest(),
      "narration",
      "",
    )).resolves.toBeNull();
  });

  it("rejects expired signed mutations", async () => {
    globalThis.__CHESSRIOT_ENV__ = "development";
    globalThis.__CHESSRIOT_VIDEO_REGEN_SHARED_SECRET__ =
      "unit-test-video-secret";
    await expect(authorizeDemoVideoRequest(
      await signedRequest(Date.now() - 61_000),
      "narration",
      "",
    )).resolves.toBeNull();
  });
});
