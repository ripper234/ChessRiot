import {
  authorizePushNotificationsManage,
  opsCorsHeaders,
} from "@/lib/ops-auth";
import {
  pushDeviceSummaryByUsername,
  sendPushServiceMessage,
} from "@/lib/push-notifications";
import { recordEvent } from "@/lib/observability";
import { validateUsername } from "@/lib/usernames";

export const dynamic = "force-dynamic";

function response(
  origin: string | null,
  payload: Record<string, unknown>,
  status = 200,
): Response {
  const headers = opsCorsHeaders(origin);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(payload), { status, headers });
}

function validServiceMessage(value: unknown): value is string {
  return typeof value === "string"
    && value === value.trim()
    && Array.from(value).length >= 1
    && Array.from(value).length <= 120
    && !/[\r\n\u0000-\u001f\u007f-\u009f\u200b\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u.test(value);
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const grant = await authorizePushNotificationsManage(request);
  if (!grant) return response(origin, { error: "not_authorized" }, 403);
  const username = validateUsername(grant.targetUsername);
  if (!username.ok) return response(origin, { error: "invalid_username" }, 400);

  if (grant.pushAction === "inspect" && grant.pushMessage === undefined) {
    const result = await pushDeviceSummaryByUsername(username.username);
    await recordEvent({
      event: "push.service_command",
      outcome: result.ok ? "success" : "rejected",
      subjectId: username.username,
      errorCode: result.ok ? null : result.code,
      metadata: { action: "inspect", active: result.ok ? result.activeSubscriptions : 0 },
    });
    if (!result.ok) return response(origin, { error: result.code }, 404);
    return response(origin, result);
  }

  if (grant.pushAction !== "send" || !validServiceMessage(grant.pushMessage)) {
    await recordEvent({
      event: "push.service_command",
      outcome: "rejected",
      subjectId: username.username,
      errorCode: "invalid_push_action",
      metadata: { action: "send" },
    });
    return response(origin, { error: "invalid_push_action" }, 400);
  }
  const result = await sendPushServiceMessage(
    username.username,
    grant.pushMessage,
    grant.nonce,
  );
  await recordEvent({
    event: "push.service_command",
    outcome: result.ok ? "success" : "rejected",
    subjectId: username.username,
    errorCode: result.ok ? null : result.code,
    metadata: {
      action: "send",
      active: result.ok ? result.active : 0,
      accepted: result.ok ? result.accepted : 0,
      failed: result.ok ? result.failed : 0,
    },
  });
  if (!result.ok) {
    const status = result.code === "player_not_found"
      ? 404
      : result.code === "no_subscribed_devices"
        ? 409
        : result.code === "push_unconfigured"
          ? 503
          : result.code === "rate_limited"
            ? 429
            : 409;
    return response(origin, { error: result.code }, status);
  }
  return response(origin, result);
}
