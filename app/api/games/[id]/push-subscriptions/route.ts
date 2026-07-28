import { enforceAccountRateLimit } from "@/lib/accounts";
import { authorizeGameRequest } from "@/lib/game-auth";
import { apiError, json, readJson } from "@/lib/http";
import {
  deletePushSubscription,
  isAllowedPushEndpoint,
  isPushEndpointHash,
  parsePushSubscription,
  publicPushConfig,
  pushSubscriptionEnabled,
  upsertPushSubscription,
} from "@/lib/push-notifications";
import { isUuid, requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

async function authorizedAccount(
  request: Request,
  gameId: string,
) {
  const authorization = await authorizeGameRequest(request, gameId);
  if (!authorization.ok) {
    return {
      response: apiError(
        authorization.status,
        authorization.code,
        authorization.message,
      ),
    } as const;
  }
  return { authorization } as const;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const access = await authorizedAccount(request, id);
  if ("response" in access) return access.response;
  if (access.authorization.game.game_mode !== "multiplayer") {
    return json({ available: false, enabled: false });
  }
  const endpointHash = request.headers.get("x-push-endpoint-hash");
  if (endpointHash !== null && !isPushEndpointHash(endpointHash)) {
    return apiError(400, "invalid_request", "Turn alert device identifier is invalid");
  }
  return json({
    available: true,
    enabled: endpointHash === null
      ? false
      : await pushSubscriptionEnabled(
        id,
        access.authorization.color,
        access.authorization.account.id,
        endpointHash,
      ),
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  if (!(await publicPushConfig()).enabled) {
    return apiError(503, "push_unavailable", "Turn alerts are not available");
  }
  const { id } = await context.params;
  const access = await authorizedAccount(request, id);
  if ("response" in access) return access.response;
  if (access.authorization.game.game_mode !== "multiplayer") {
    return apiError(409, "multiplayer_only", "Turn alerts are only available in multiplayer games");
  }
  const rate = await enforceAccountRateLimit(
    access.authorization.account.id,
    "push_subscription_write",
    20,
    60 * 60,
  );
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many alert changes. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const body = await readJson(request);
  const requestId = body?.requestId;
  const subscription = parsePushSubscription(body?.subscription);
  if (!isUuid(requestId) || !subscription) {
    return apiError(400, "invalid_request", "Turn alert subscription is invalid");
  }
  await upsertPushSubscription(
    id,
    access.authorization.color,
    access.authorization.account.id,
    subscription,
  );
  return json({ enabled: true });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const { id } = await context.params;
  const access = await authorizedAccount(request, id);
  if ("response" in access) return access.response;
  if (access.authorization.game.game_mode !== "multiplayer") {
    return apiError(409, "multiplayer_only", "Turn alerts are only available in multiplayer games");
  }
  const rate = await enforceAccountRateLimit(
    access.authorization.account.id,
    "push_subscription_write",
    20,
    60 * 60,
  );
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many alert changes. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const body = await readJson(request);
  const requestId = body?.requestId;
  const endpoint = body?.endpoint;
  if (!isUuid(requestId) || !isAllowedPushEndpoint(endpoint)) {
    return apiError(400, "invalid_request", "Turn alert subscription is invalid");
  }
  await deletePushSubscription(
    id,
    access.authorization.color,
    access.authorization.account.id,
    endpoint,
  );
  return json({ enabled: false });
}
