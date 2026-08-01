import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/app", "/demo", "/privacy", "/changelog"],
      disallow: ["/api/", "/g/", "/join/", "/verify", "/capture-lab"],
    },
    sitemap: "https://chessriot.gg/sitemap.xml",
  };
}
