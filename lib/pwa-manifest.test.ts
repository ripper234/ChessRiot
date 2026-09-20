import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

interface Manifest {
  display: string;
  start_url: string;
  scope: string;
  icons: ManifestIcon[];
}

function readManifest(): Manifest {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "public", "manifest.webmanifest"), "utf8"),
  ) as Manifest;
}

describe("installable app assets", () => {
  it("provides standalone metadata and install icons", () => {
    const manifest = readManifest();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/app");
    expect(manifest.scope).toBe("/");
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual([
      "192x192",
      "512x512",
      "512x512",
    ]);
    for (const icon of manifest.icons) {
      expect(existsSync(resolve(process.cwd(), "public", icon.src.slice(1)))).toBe(true);
    }
  });

  it("keeps authenticated game and API responses out of the service-worker cache", () => {
    const source = readFileSync(resolve(process.cwd(), "public", "sw.js"), "utf8");
    expect(source).toContain('url.pathname.startsWith("/_next/static/")');
    expect(source).toContain('url.pathname.startsWith("/icons/")');
    expect(source).not.toContain('cache.add("/api/');
    expect(source).not.toContain('cache.add("/g/');
    expect(source).not.toContain('cache.add("/join/');
    expect(source).toContain("Promise.allSettled");
    expect(source).not.toContain("cache.addAll(PRECACHE)");
  });

  it("accepts only fixed-title turn, friend-request, or bounded service payloads", () => {
    const source = readFileSync(resolve(process.cwd(), "public", "sw.js"), "utf8");
    expect(source).toContain('payload.type === "your_turn"');
    expect(source).toContain('payload.type === "service"');
    expect(source).toContain('payload.type === "friend_request"');
    expect(source).toContain('Array.from(payload.body).length <= 120');
    expect(source).toContain('showNotification("ChessRiot"');
    expect(source).toContain("diagnosticId");
    expect(source).toContain('PUSH_DIAGNOSTIC_RECEIPT_TYPE = "chessriot:push-diagnostic-receipt"');
    expect(source).toContain('LOCAL_PUSH_DIAGNOSTIC_EVENT_TYPE = "chessriot:local-push-diagnostic-event"');
    expect(source).toContain('"push_received"');
    expect(source).toContain('"show_resolved"');
    expect(source).toContain('"show_rejected"');
    expect(source).toContain('"notification_active"');
    expect(source).toContain("PUSH_DIAGNOSTIC_WORKER_VERSION");
    expect(source).toContain("requireInteraction: true");
    expect(source).toContain('const path = gameId ? `/g/${gameId}` : friendRequest ? "/?activity=1" : "/app"');
    expect(source).toContain("sent you a friend request");
    expect(source).toContain("friend-request-${friendRequest.requestId}");
    expect(source).not.toContain("payload.title");
    expect(source).not.toContain("payload.path");
    expect(source).toContain('addEventListener("pushsubscriptionchange"');
    expect(source).toContain('caches.open(PUSH_CONSENT_CACHE)');
    expect(source).toContain("readPushConsent");
    expect(source).toContain("JSON.parse(await response.text())");
    expect(source).toContain("expectedUsername: consent.username");
    expect(source).toContain("finalConsent?.token !== consent.token");
    expect(source).toContain("preserveLegacy: true");
    expect(source).toContain('fetch("/api/me/push-devices"');
    expect(source).toContain('credentials: "same-origin"');
    expect(source).toContain("\\u202a-\\u202e");
  });
});
