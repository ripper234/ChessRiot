import {
  requireGoogleApiAccount,
  listAccountGames,
  parseAccountGamesCursor,
  type AccountGamesView,
} from "@/lib/accounts";
import type { GameMode } from "@/lib/game-types";
import { isGameVariantId } from "@/lib/game-variants";
import { apiError, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const account = await requireGoogleApiAccount(request);
  if (!account) return apiError(401, "sign_in_required", "Sign in with Google to view history");
  if (!account.username) return apiError(428, "username_required", "Choose a username first");
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
  const rawMode = search.get("mode");
  if (rawMode !== null && rawMode !== "all" && rawMode !== "solo" && rawMode !== "multiplayer") {
    return apiError(400, "invalid_mode", "Game mode filter is invalid");
  }
  const rawVariant = search.get("variant");
  if (rawVariant !== null && rawVariant !== "all" && !isGameVariantId(rawVariant)) {
    return apiError(400, "invalid_variant", "Game type filter is invalid");
  }
  const rawMagic = search.get("magic");
  if (rawMagic !== null && rawMagic !== "all" && rawMagic !== "yes" && rawMagic !== "no") {
    return apiError(400, "invalid_magic", "Magic filter is invalid");
  }
  return json(await listAccountGames(account.id, {
    cursor,
    limit,
    view: (rawView ?? "all") as AccountGamesView,
    mode: rawMode === "solo" || rawMode === "multiplayer" ? rawMode as GameMode : null,
    variantId: rawVariant && rawVariant !== "all" ? rawVariant : null,
    magic: rawMagic === "yes" ? true : rawMagic === "no" ? false : null,
  }));
}
