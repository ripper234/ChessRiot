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
    expect(manifest.start_url).toBe("/");
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
  });
});

