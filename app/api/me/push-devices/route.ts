import {
  enforceAccountRateLimit,
  requireGoogleApiAccount,
} from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import {
  deletePushDevice,
  isAllowedPushEndpoint,
  isPushEndpointHash,
  parsePushSubscription,
  publicPushConfig,
  pushDeviceStatus,
  upsertPushDevice,
} from "@/lib/push-notifications";
import { isUuid, requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

async function authenticatedAccount(request: Request) {
  const account = await requireGoogleApiAccount(request);
  if (!account) {
    return { response: apiError(401, "account_required", "Sign in to manage notifications") } as const;
  }
  if (!account.username) {
    return { response: apiError(409, "username_required", "Choose a username first") } as const;
  }
  return { account } as const;
}

async function allowWrite(accountId: string): Promise<Response | null> {
  const rate = await enforceAccountRateLimit(
    accountId,
    "push_device_write",
    20,
    60 * 60,
  );
  if (rate.allowed) return null;
  return json(
    { error: { code: "rate_limited", message: "Too many notification changes. Try again later." } },
    { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
  );
}

export async function GET(request: Request): Promise<Response> {
  const access = await authenticatedAccount(request);
  if ("response" in access && access.response) return access.response;
  const config = await publicPushConfig();
  if (!config.enabled) {
    return json({ available: false, enabled: false, owned: false, legacy: false, stale: false });
  }
  const endpointHash = request.headers.get("x-push-endpoint-hash");
  if (endpointHash !== null && !isPushEndpointHash(endpointHash)) {
    return apiError(400, "invalid_request", "Notification device identifier is invalid");
  }
  const status = endpointHash === null
    ? { enabled: false, owned: false, legacy: false, stale: false }
    : await pushDeviceStatus(access.account.id, endpointHash);
  return json({
    available: true,
    ...status,
  });
}

export async function PUT(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  if (!(await publicPushConfig()).enabled) {
    return apiError(503, "push_unavailable", "Notifications are not available");
  }
  const access = await authenticatedAccount(request);
  if ("response" in access && access.response) return access.response;
  const body = await readJson(request);
  if (typeof body?.expectedUsername !== "string") {
    return apiError(400, "expected_username_required", "Notification owner is required");
  }
  if (body.expectedUsername !== access.account.username) {
    return apiError(409, "account_changed", "The signed-in account changed");
  }
  const limited = await allowWrite(access.account.id);
  if (limited) return limited;
  const requestId = body?.requestId;
  const subscription = parsePushSubscription(body?.subscription);
  if (!isUuid(requestId) || !subscription) {
    return apiError(400, "invalid_request", "Notification subscription is invalid");
  }
  const registration = await upsertPushDevice(access.account.id, subscription);
  if (registration === "stale") {
    return apiError(409, "stale_subscription", "Create a fresh browser notification subscription");
  }
  return json({ enabled: true });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const access = await authenticatedAccount(request);
  if ("response" in access && access.response) return access.response;
  const body = await readJson(request);
  if (
    typeof body?.expectedUsername === "string"
    && body.expectedUsername !== access.account.username
  ) {
    return apiError(409, "account_changed", "The signed-in account changed");
  }
  const requestId = body?.requestId;
  const endpoint = body?.endpoint;
  if (!isUuid(requestId) || !isAllowedPushEndpoint(endpoint)) {
    return apiError(400, "invalid_request", "Notification subscription is invalid");
  }
  await deletePushDevice(access.account.id, endpoint, {
    preserveLegacy: body?.preserveLegacy === true,
  });
  return json({ enabled: false });
}
