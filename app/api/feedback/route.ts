import { ensureSchema, getDatabase } from "@/db";
import { apiError, json, readJson } from "@/lib/http";
import { enforceAccountRateLimit, resolveGuestApiAccount } from "@/lib/accounts";
import { appEnvironment } from "@/lib/runtime";
import { requestIsSameOrigin, isSecret, isUuid } from "@/lib/validation";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

function cleanPage(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.length > 180) return "/";
  return value.split("#", 1)[0].split("?", 1)[0];
}

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return apiError(403, "wrong_origin", "Request origin is not allowed");
  const body = await readJson(request);
  if (!body) return apiError(400, "invalid_request", "Invalid JSON request");
  const title = cleanText(body.title, 120);
  const comment = body.comment === null || body.comment === undefined || body.comment === ""
    ? null
    : cleanText(body.comment, 2_000);
  const requestId = body.requestId;
  const guestToken = body.guestToken;
  if (!title || (body.comment && !comment) || !isUuid(requestId) || !isSecret(guestToken)) {
    return apiError(400, "invalid_feedback", "Feedback title, comment, or request id is invalid");
  }
  const account = await resolveGuestApiAccount({
    token: guestToken,
    displayName: "Guest player",
  });
  const rate = await enforceAccountRateLimit(
    account.id,
    "feedback",
    10,
    60 * 60,
  );
  if (!rate.allowed) {
    return json(
      { error: { code: "rate_limited", message: "Too much feedback was submitted. Try again later." } },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }

  await ensureSchema();
  const id = crypto.randomUUID();
  try {
    await getDatabase()
      .prepare(`INSERT INTO feedback (
        id, request_id, title, comment, page, environment, app_version, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?)`)
      .bind(
        id,
        requestId,
        title,
        comment,
        cleanPage(body.page),
        appEnvironment(),
        APP_VERSION,
        new Date().toISOString(),
      )
      .run();
  } catch {
    const existing = await getDatabase()
      .prepare("SELECT id FROM feedback WHERE request_id = ?")
      .bind(requestId)
      .first<{ id: string }>();
    if (!existing) return apiError(500, "feedback_failed", "Feedback could not be saved");
    return json({ id: existing.id, status: "received" });
  }
  return json({ id, status: "received" }, { status: 201 });
}
