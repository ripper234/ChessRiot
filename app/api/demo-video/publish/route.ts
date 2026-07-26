import {
  authorizeDemoVideoRequest,
  claimDemoVideoPublish,
  claimDemoVideoNonce,
  decodeDemoVideoDigest,
  DEMO_VIDEO_CAPTIONS,
  DEMO_VIDEO_MAX_BYTES,
  demoVideoBucketBinding,
  failDemoVideoJob,
  latestDemoVideoManifest,
  type DemoVideoManifest,
  updateDemoVideoJob,
} from "@/lib/demo-video";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export async function POST(request: Request) {
  const bytes = Number(request.headers.get("x-demo-video-bytes") ?? "");
  const duration = Number(request.headers.get("x-demo-video-duration") ?? "");
  const mimeType = request.headers.get("x-demo-video-mime") ?? "";
  const sha256 = request.headers.get("x-demo-video-sha256") ?? "";
  const details = `${bytes}\n${duration}\n${mimeType}\n${sha256}`;
  const authorized = await authorizeDemoVideoRequest(request, "publish", details);
  if (!authorized) {
    return Response.json(
      { error: "not_authorized" },
      { status: 403, headers: responseHeaders },
    );
  }
  if (
    !Number.isInteger(bytes)
    || bytes < 100_000
    || bytes > DEMO_VIDEO_MAX_BYTES
    || !Number.isFinite(duration)
    || duration < 85
    || duration > 95
    || !/^video\/webm(?:;|$)/.test(mimeType)
    || !decodeDemoVideoDigest(sha256)
    || !request.body
  ) {
    return Response.json(
      { error: "invalid_video" },
      { status: 400, headers: responseHeaders },
    );
  }
  const timestamp = Number(request.headers.get("x-demo-video-timestamp"));
  if (!(await claimDemoVideoNonce(authorized.nonce, timestamp))) {
    return Response.json(
      { error: "request_replayed" },
      { status: 409, headers: responseHeaders },
    );
  }
  const bucket = demoVideoBucketBinding();
  if (!bucket) {
    await failDemoVideoJob(
      authorized.jobId,
      "media_storage_unavailable",
    );
    return Response.json(
      { error: "media_storage_unavailable" },
      { status: 503, headers: responseHeaders },
    );
  }
  if (!(await claimDemoVideoPublish(authorized.jobId))) {
    return Response.json(
      { error: "job_not_rendering" },
      { status: 409, headers: responseHeaders },
    );
  }
  const digest = decodeDemoVideoDigest(sha256);
  if (!digest) {
    await failDemoVideoJob(authorized.jobId, "invalid_video", true);
    return Response.json(
      { error: "invalid_video" },
      { status: 400, headers: responseHeaders },
    );
  }
  const generatedAt = new Date().toISOString();
  const mediaKey = `demo-video/${authorized.jobId}.webm`;
  const captionsKey = `demo-video/${authorized.jobId}.vtt`;
  const previousManifest = await latestDemoVideoManifest();
  try {
    const stored = await bucket.put(mediaKey, request.body, {
      sha256: digest,
      httpMetadata: {
        contentType: mimeType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        jobId: authorized.jobId,
        durationSeconds: String(duration),
        generatedAt,
      },
    });
    if (stored.size !== bytes) {
      await bucket.delete(mediaKey);
      throw new Error("size_mismatch");
    }
    await bucket.put(captionsKey, DEMO_VIDEO_CAPTIONS, {
      httpMetadata: {
        contentType: "text/vtt; charset=utf-8",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    const manifest: DemoVideoManifest = {
      version: 1,
      jobId: authorized.jobId,
      mediaKey,
      captionsKey,
      mimeType,
      durationSeconds: Math.round(duration * 10) / 10,
      sizeBytes: bytes,
      sha256,
      generatedAt,
    };
    try {
      await bucket.put("demo-video/latest.json", JSON.stringify(manifest), {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "no-store",
        },
      });
    } catch {
      try {
        await bucket.delete([mediaKey, captionsKey]);
      } catch {
        // The manifest still points to the prior video.
      }
      throw new Error("manifest_publish_failed");
    }
    try {
      await updateDemoVideoJob(authorized.jobId, "ready", {
        durationSeconds: Math.round(duration),
        sizeBytes: bytes,
        mediaKey,
      });
    } catch {
      // The manifest is the publication authority. Bookkeeping can recover.
    }
    if (
      previousManifest
      && previousManifest.jobId !== authorized.jobId
    ) {
      try {
        await bucket.delete([
          previousManifest.mediaKey,
          previousManifest.captionsKey,
        ]);
      } catch {
        // Old immutable objects can be pruned on a later regeneration.
      }
    }
    return Response.json(
      {
        status: "ready",
        generatedAt,
        durationSeconds: manifest.durationSeconds,
      },
      { headers: responseHeaders },
    );
  } catch {
    await failDemoVideoJob(authorized.jobId, "publish_failed", true);
    return Response.json(
      { error: "publish_failed" },
      { status: 500, headers: responseHeaders },
    );
  }
}
