import { enforceAccountRateLimit, requireGoogleApiAccount } from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import { blockPlayer, listBlockedPlayers, unblockPlayer } from "@/lib/social";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  return json({ blocked: await listBlockedPlayers(account.id) });
}

async function usernameBody(request: Request): Promise<string | null> {
  const body = await readJson(request);
  return body && typeof body.username === "string" ? body.username : null;
}

export async function POST(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  const rate = await enforceAccountRateLimit(account.id, "player_block", 30, 24 * 60 * 60);
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many safety changes. Try later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const username = await usernameBody(request);
  if (!username) return apiError(400, "invalid_username", "Choose a player");
  const result = await blockPlayer(account.id, username);
  return result.ok ? json(result) : apiError(404, "not_found", result.message);
}

export async function DELETE(request: Request): Promise<Response> {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google first");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
  const username = await usernameBody(request);
  if (!username) return apiError(400, "invalid_username", "Choose a player");
  if (!(await unblockPlayer(account.id, username))) {
    return apiError(404, "not_found", "Blocked player not found");
  }
  return json({ unblocked: true });
}
