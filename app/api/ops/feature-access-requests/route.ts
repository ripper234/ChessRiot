import {
  isRequestableFeatureKey,
  listPendingFeatureAccessRequests,
  resolveFeatureAccessRequest,
} from "@/lib/feature-access";
import {
  authorizeFeatureAccessRequestsManage,
  opsCorsHeaders,
} from "@/lib/ops-auth";
import { recordEvent } from "@/lib/observability";
import { isUuid } from "@/lib/validation";

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

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const grant = await authorizeFeatureAccessRequestsManage(request);
  if (!grant) return response(origin, { error: "not_authorized" }, 403);
  if (!isRequestableFeatureKey(grant.featureKey)) {
    return response(origin, { error: "invalid_feature" }, 400);
  }
  if (grant.action === "list" && grant.requestId === undefined) {
    const queue = await listPendingFeatureAccessRequests(grant.featureKey);
    return response(origin, { feature: grant.featureKey, ...queue });
  }
  if (
    (grant.action === "approve" || grant.action === "dismiss")
    && isUuid(grant.requestId)
  ) {
    const result = await resolveFeatureAccessRequest(
      grant.requestId,
      grant.featureKey,
      grant.action,
    );
    if (!result.ok) return response(origin, { error: "access_request_not_found" }, 404);
    await recordEvent({
      event: grant.action === "approve"
        ? "feature_access.approved"
        : "feature_access.dismissed",
      outcome: "success",
      subjectId: grant.requestId,
      metadata: { feature: grant.featureKey },
    });
    return response(origin, {
      feature: grant.featureKey,
      requestId: grant.requestId,
      username: result.username,
      decision: result.decision,
      enabled: result.enabled,
    });
  }
  return response(origin, { error: "invalid_access_request_action" }, 400);
}
