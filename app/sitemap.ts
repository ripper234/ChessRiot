import type { MetadataRoute } from "next";

const ORIGIN = "https://chessriot.gg";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/app", "/demo", "/privacy", "/changelog"].map((path) => ({
    url: `${ORIGIN}${path}`,
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1 : path === "/app" ? 0.9 : 0.5,
  }));
}
