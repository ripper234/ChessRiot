import { listActivity, markActivityRead } from "@/lib/activity";
import { requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  return json(await listActivity(account.id));
}

export async function POST(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  const body = await readJson(request);
  if (!body || typeof body.snapshotAt !== "string") {
    return apiError(400, "invalid_snapshot", "Activity snapshot is invalid");
  }
  try {
    await markActivityRead(account.id, body.snapshotAt);
  } catch {
    return apiError(400, "invalid_snapshot", "Activity snapshot is invalid");
  }
  return json({ read: true });
}
