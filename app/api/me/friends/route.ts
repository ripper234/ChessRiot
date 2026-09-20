import { requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import { listSocialSummary, removeFriend } from "@/lib/social";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  return json(await listSocialSummary(account.id));
}

export async function DELETE(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  const body = await readJson(request);
  if (!body || typeof body.username !== "string") {
    return apiError(400, "invalid_username", "Choose a player");
  }
  if (!(await removeFriend(account.id, body.username))) {
    return apiError(404, "not_found", "Friend not found");
  }
  return json({ removed: true });
}
