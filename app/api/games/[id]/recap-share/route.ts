import { enforceAccountRateLimit } from "@/lib/accounts";
import { authorizeGameRequest } from "@/lib/game-auth";
import {
  getOrCreateGameRecapShare,
  revokeGameRecapShare,
} from "@/lib/game-recaps";
import { apiError, json } from "@/lib/http";
import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

async function authorizeCompletedGame(
  request: Request,
  id: string,
) {
  if (!requestIsSameOrigin(request)) {
    return { response: apiError(403, "wrong_origin", "Request origin is not allowed") } as const;
  }
  const authorization = await authorizeGameRequest(request, id);
  if (!authorization.ok) {
    return {
      response: apiError(
        authorization.status,
        authorization.code,
        authorization.message,
      ),
    } as const;
  }
  if (authorization.game.status !== "completed") {
    return { response: apiError(409, "game_not_complete", "Finish the game before sharing a recap") } as const;
  }
  return { authorization } as const;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const result = await authorizeCompletedGame(request, id);
  if ("response" in result) return result.response!;
  const rate = await enforceAccountRateLimit(
    result.authorization.account.id,
    "game_recap_share",
    20,
    60 * 60,
  );
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too many recap changes. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }
  const share = await getOrCreateGameRecapShare(id);
  const url = new URL(`/recap/${share.id}`, request.url).toString();
  return json({ url, created: share.created }, { status: share.created ? 201 : 200 });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const result = await authorizeCompletedGame(request, id);
  if ("response" in result) return result.response!;
  await revokeGameRecapShare(id);
  return new Response(null, { status: 204 });
}
