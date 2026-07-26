import {
  authorizeDemoVideoRequest,
  beginDemoVideoJob,
  claimDemoVideoNonce,
  failDemoVideoJob,
  requestDemoVideoNarration,
  updateDemoVideoJob,
} from "@/lib/demo-video";

export const dynamic = "force-dynamic";

const responseHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export async function POST(request: Request) {
  const authorized = await authorizeDemoVideoRequest(request, "narration", "");
  if (!authorized) {
    return Response.json(
      { error: "not_authorized" },
      { status: 403, headers: responseHeaders },
    );
  }
  const timestamp = Number(request.headers.get("x-demo-video-timestamp"));
  if (!(await claimDemoVideoNonce(authorized.nonce, timestamp))) {
    return Response.json(
      { error: "request_replayed" },
      { status: 409, headers: responseHeaders },
    );
  }
  const start = await beginDemoVideoJob(authorized.jobId);
  if (!start.ok) {
    return Response.json(
      { error: start.error },
      { status: start.status, headers: responseHeaders },
    );
  }
  let narration: Response;
  try {
    narration = await requestDemoVideoNarration();
  } catch {
    await failDemoVideoJob(authorized.jobId, "narration_network_error");
    return Response.json(
      { error: "narration_failed" },
      { status: 502, headers: responseHeaders },
    );
  }
  if (!narration.ok || !narration.body) {
    await failDemoVideoJob(
      authorized.jobId,
      narration.status === 429
        ? "narration_rate_limited"
        : "narration_provider_error",
    );
    return Response.json(
      { error: "narration_failed" },
      { status: narration.status === 429 ? 429 : 502, headers: responseHeaders },
    );
  }
  await updateDemoVideoJob(authorized.jobId, "rendering");
  const headers = new Headers(responseHeaders);
  headers.set("content-type", narration.headers.get("content-type") ?? "audio/mpeg");
  headers.set("x-demo-video-job", authorized.jobId);
  return new Response(narration.body, { headers });
}
