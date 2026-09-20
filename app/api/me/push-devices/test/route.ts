import {
  enforceAccountRateLimit,
  requireGoogleApiAccount,
} from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import {
  isAllowedPushEndpoint,
  sendPushDeviceTest,
} from "@/lib/push-notifications";
import { isUuid, requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account?.username) {
    return apiError(401, "account_required", "Sign in to test notifications");
  }
  const rate = await enforceAccountRateLimit(
    account.id,
    "push_device_self_test",
    6,
    60 * 60,
  );
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many notification tests. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const body = await readJson(request);
  if (
    !isUuid(body?.requestId)
    || body?.expectedUsername !== account.username
    || !isAllowedPushEndpoint(body?.endpoint)
  ) {
    return apiError(400, "invalid_request", "Notification test request is invalid");
  }
  const outcome = await sendPushDeviceTest(
    account.id,
    body.endpoint,
    body.requestId,
  );
  if (outcome === "not_found") {
    return apiError(409, "device_not_registered", "This device is not registered");
  }
  if (outcome === "unconfigured") {
    return apiError(503, "push_unavailable", "Notifications are not configured");
  }
  return json({ outcome });
}
