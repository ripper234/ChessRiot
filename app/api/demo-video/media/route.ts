import {
  DEMO_VIDEO_FALLBACK_MEDIA,
  demoVideoBucketBinding,
  latestDemoVideoManifest,
} from "@/lib/demo-video";

export const dynamic = "force-dynamic";

interface ByteRange {
  offset: number;
  length: number;
}

function parseRange(value: string | null, size: number): ByteRange | null | false {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return false;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return false;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }
  const offset = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isInteger(offset)
    || !Number.isInteger(requestedEnd)
    || offset < 0
    || offset >= size
    || requestedEnd < offset
  ) return false;
  const end = Math.min(requestedEnd, size - 1);
  return { offset, length: end - offset + 1 };
}

function rangeNotSatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: {
      "accept-ranges": "bytes",
      "content-range": `bytes */${size}`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function serveMedia(request: Request, headOnly: boolean): Promise<Response> {
  const manifest = await latestDemoVideoManifest();
  const bucket = demoVideoBucketBinding();
  if (!manifest || !bucket) {
    return Response.redirect(new URL(DEMO_VIDEO_FALLBACK_MEDIA, request.url), 307);
  }
  const range = parseRange(request.headers.get("range"), manifest.sizeBytes);
  if (range === false) return rangeNotSatisfiable(manifest.sizeBytes);
  let object: R2Object | R2ObjectBody | null;
  try {
    object = headOnly
      ? await bucket.head(manifest.mediaKey)
      : await bucket.get(
        manifest.mediaKey,
        range ? { range } : undefined,
      );
  } catch {
    return range ? rangeNotSatisfiable(manifest.sizeBytes) : new Response(null, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
  if (!object) {
    return Response.redirect(new URL(DEMO_VIDEO_FALLBACK_MEDIA, request.url), 307);
  }
  const headers = new Headers({
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=60, must-revalidate",
    "content-type": manifest.mimeType,
    etag: object.httpEtag,
    "x-content-type-options": "nosniff",
  });
  if (range) {
    headers.set("content-length", String(range.length));
    headers.set(
      "content-range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${manifest.sizeBytes}`,
    );
    return new Response(
      headOnly ? null : (object as R2ObjectBody).body,
      { status: 206, headers },
    );
  }
  headers.set("content-length", String(manifest.sizeBytes));
  return new Response(headOnly ? null : (object as R2ObjectBody).body, { headers });
}

export async function GET(request: Request) {
  return serveMedia(request, false);
}

export async function HEAD(request: Request) {
  return serveMedia(request, true);
}
