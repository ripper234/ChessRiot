import {
  DEMO_VIDEO_CAPTIONS,
  demoVideoBucketBinding,
  latestDemoVideoManifest,
} from "@/lib/demo-video";

export const dynamic = "force-dynamic";

export async function GET() {
  const manifest = await latestDemoVideoManifest();
  const bucket = demoVideoBucketBinding();
  if (!manifest || !bucket) {
    return new Response(DEMO_VIDEO_CAPTIONS, {
      headers: {
        "cache-control": "public, max-age=300",
        "content-type": "text/vtt; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }
  const object = await bucket.get(manifest.captionsKey);
  if (!object) {
    return new Response(DEMO_VIDEO_CAPTIONS, {
      headers: {
        "cache-control": "public, max-age=300",
        "content-type": "text/vtt; charset=utf-8",
        "x-content-type-options": "nosniff",
      },
    });
  }
  return new Response(object.body, {
    headers: {
      "cache-control": "public, max-age=60, must-revalidate",
      "content-length": String(object.size),
      "content-type": "text/vtt; charset=utf-8",
      etag: object.httpEtag,
      "x-content-type-options": "nosniff",
    },
  });
}
