import {
  DEMO_VIDEO_DURATION_SECONDS,
  latestDemoVideoManifest,
} from "@/lib/demo-video";

export const dynamic = "force-dynamic";

export async function GET() {
  const manifest = await latestDemoVideoManifest();
  return Response.json(
    manifest
      ? {
        source: "generated",
        durationSeconds: manifest.durationSeconds,
        generatedAt: manifest.generatedAt,
        sizeBytes: manifest.sizeBytes,
        mimeType: manifest.mimeType,
      }
      : {
        source: "bundled",
        durationSeconds: DEMO_VIDEO_DURATION_SECONDS,
        generatedAt: null,
        sizeBytes: null,
        mimeType: "video/mp4",
      },
    {
      headers: {
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    },
  );
}
