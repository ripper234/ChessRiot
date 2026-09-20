import { enforceAccountRateLimit, requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import { cancelOutgoingFriendRequest, respondToFriendRequest } from "@/lib/social";
import { isUuid, requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  const { id } = await context.params;
  if (!isUuid(id)) return apiError(404, "not_found", "Friend request not found");
  const body = await readJson(request);
  if (!body || (body.action !== "accept" && body.action !== "decline")) {
    return apiError(400, "invalid_action", "Choose accept or decline");
  }
  const rate = await enforceAccountRateLimit(account.id, "friend_request_response", 60, 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many friend request responses. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const result = await respondToFriendRequest(account.id, id, body.action === "accept");
  if (!result.ok) {
    return apiError(result.code === "not_found" ? 404 : 409, result.code, result.message);
  }
  return json(result);
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  const { id } = await context.params;
  if (!isUuid(id)) return apiError(404, "not_found", "Friend request not found");
  const rate = await enforceAccountRateLimit(account.id, "friend_request_cancel", 60, 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many friend request changes." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  if (!(await cancelOutgoingFriendRequest(account.id, id))) {
    return apiError(404, "not_found", "Pending friend request not found");
  }
  return json({ cancelled: true });
}
