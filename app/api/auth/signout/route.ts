import {
  clearGoogleFlowCookie,
  clearGoogleSessionCookie,
  googleSessionAccountFromHeaders,
} from "@/lib/google-auth";
import { json, readJson } from "@/lib/http";
import { deletePushDevice, isAllowedPushEndpoint } from "@/lib/push-notifications";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return Response.json(
      { error: "wrong_origin" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  const [account, body] = await Promise.all([
    googleSessionAccountFromHeaders(request.headers),
    readJson(request),
  ]);
  if (account && isAllowedPushEndpoint(body?.endpoint)) {
    await deletePushDevice(account.id, body.endpoint);
  }
  const response = json({ signedIn: false });
  response.headers.append("set-cookie", clearGoogleFlowCookie());
  response.headers.append("set-cookie", clearGoogleSessionCookie());
  return response;
}
