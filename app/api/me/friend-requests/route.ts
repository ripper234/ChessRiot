import { enforceAccountRateLimit, requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import { sendFriendRequest } from "@/lib/social";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  const rate = await enforceAccountRateLimit(account.id, "friend_request", 30, 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many friend requests. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const body = await readJson(request);
  if (!body || typeof body.username !== "string") {
    return apiError(400, "invalid_username", "Enter a username");
  }
  const result = await sendFriendRequest(account, body.username);
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 409;
    return apiError(status, result.code, result.message);
  }
  return json(result, { status: result.state === "sent" ? 201 : 200 });
}
