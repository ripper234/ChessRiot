import {
  authorizeDemoVideoRequest,
  claimDemoVideoNonce,
  failDemoVideoJob,
} from "@/lib/demo-video";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const errorCode = (request.headers.get("x-demo-video-error") ?? "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 48);
  const authorized = await authorizeDemoVideoRequest(
    request,
    "fail",
    errorCode,
  );
  if (!authorized || !errorCode) {
    return Response.json(
      { error: "not_authorized" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  const timestamp = Number(request.headers.get("x-demo-video-timestamp"));
  if (!(await claimDemoVideoNonce(authorized.nonce, timestamp))) {
    return Response.json(
      { error: "request_replayed" },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }
  await failDemoVideoJob(authorized.jobId, errorCode);
  return Response.json(
    { status: "failed" },
    { headers: { "cache-control": "no-store" } },
  );
}
