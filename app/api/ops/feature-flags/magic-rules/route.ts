import { authorizeFeatureFlagsManage, opsCorsHeaders } from "@/lib/ops-auth";
import {
  listFeatureUsernames,
  MAGIC_RULES_FEATURE,
  setFeatureByUsername,
} from "@/lib/social";
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

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const grant = await authorizeFeatureFlagsManage(request);
  if (!grant) return response(origin, { error: "not_authorized" }, 403);

  if (grant.targetUsername === undefined) {
    return response(origin, {
      feature: MAGIC_RULES_FEATURE,
      usernames: await listFeatureUsernames(MAGIC_RULES_FEATURE),
    });
  }
  const target = validateUsername(grant.targetUsername);
  if (!target.ok || typeof grant.enabled !== "boolean") {
    return response(origin, { error: "invalid_feature_change" }, 400);
  }
  const result = await setFeatureByUsername(
    target.username,
    MAGIC_RULES_FEATURE,
    grant.enabled,
  );
  if (!result.ok) return response(origin, { error: "player_not_found" }, 404);
  return response(origin, {
    feature: MAGIC_RULES_FEATURE,
    username: result.username,
    enabled: result.enabled,
  });
}
