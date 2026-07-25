import {
  requireApiAccount,
  listAccountGames,
  parseAccountGamesCursor,
  type AccountGamesView,
} from "@/lib/accounts";
import { apiError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const account = await requireApiAccount(request);
  if (!account) return apiError(401, "account_required", "Sign in and complete the human check");
  const search = new URL(request.url).searchParams;
  const rawCursor = search.get("cursor");
  const cursor = parseAccountGamesCursor(rawCursor);
  if (rawCursor && !cursor) {
    return apiError(400, "invalid_cursor", "Game list cursor is invalid");
  }
  const rawLimit = search.get("limit");
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  if (
    limit !== undefined
    && (!Number.isInteger(limit) || limit < 1 || limit > 50)
  ) {
    return apiError(400, "invalid_limit", "Game list limit must be from 1 to 50");
  }
  const rawView = search.get("view");
  if (rawView !== null && rawView !== "all" && rawView !== "watch") {
    return apiError(400, "invalid_view", "Game list view is invalid");
  }
  return json(await listAccountGames(account.id, {
    cursor,
    limit,
    view: (rawView ?? "all") as AccountGamesView,
  }));
}
