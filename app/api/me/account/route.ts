import { clearGoogleFlowCookie, clearGoogleSessionCookie, googleSessionDetailsFromHeaders } from "@/lib/google-auth";
import { apiError, json, readJson } from "@/lib/http";
import { deleteAccountData } from "@/lib/privacy";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";
const RECENT_AUTH_SECONDS = 10 * 60;

export async function DELETE(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const session = await googleSessionDetailsFromHeaders(request.headers);
  if (!session) return apiError(401, "sign_in_required", "Sign in with Google first");
  const now = Math.floor(Date.now() / 1000);
  if (now - session.authenticatedAt > RECENT_AUTH_SECONDS) {
    return apiError(403, "recent_auth_required", "Verify with Google again before deleting your account");
  }
  const body = await readJson(request);
  if (!body || typeof body.username !== "string") {
    return apiError(400, "confirmation_required", "Type your username to confirm");
  }
  if (!(await deleteAccountData(session.account.id, body.username))) {
    return apiError(409, "confirmation_mismatch", "The username does not match");
  }
  const response = json({ deleted: true });
  response.headers.append("set-cookie", clearGoogleFlowCookie());
  response.headers.append("set-cookie", clearGoogleSessionCookie());
  return response;
}
