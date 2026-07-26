import { enforceAccountRateLimit, resolveGuestApiAccount } from "@/lib/accounts";
import { apiError, json, readJson } from "@/lib/http";
import { createMagicInterpretationToken } from "@/lib/magic-interpretation-token";
import { interpretMagicPrompt } from "@/lib/magic-rules-interpreter";
import {
  isSecret,
  normalizeDisplayName,
  requestIsSameOrigin,
} from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) {
    return apiError(403, "wrong_origin", "Request origin is not allowed");
  }
  const body = await readJson(request);
  if (!body) return apiError(400, "invalid_request", "Invalid JSON request");
  const displayName = normalizeDisplayName(body.displayName);
  if (!displayName || !isSecret(body.guestToken)) {
    return apiError(400, "invalid_request", "Enter your display name before interpreting rules");
  }

  const account = await resolveGuestApiAccount({
    token: body.guestToken,
    displayName,
  });
  const rate = await enforceAccountRateLimit(
    account.id,
    "magic_interpret",
    30,
    60 * 60,
  );
  if (!rate.allowed) {
    return json(
      {
        error: {
          code: "rate_limited",
          message: "Too many Magic interpretations. Try again later.",
        },
      },
      { status: 429, headers: { "retry-after": String(rate.retryAfter) } },
    );
  }

  const interpretation = await interpretMagicPrompt(body.prompt);
  if (!interpretation.ok) {
    const status = interpretation.code === "invalid_prompt"
      ? 400
      : interpretation.code === "unavailable"
        ? 503
        : 422;
    return apiError(status, `magic_${interpretation.code}`, interpretation.message);
  }
  const interpretationToken = await createMagicInterpretationToken(
    account.id,
    interpretation.prompt,
    interpretation.compiled,
  );
  return json({
    prompt: interpretation.prompt,
    labels: interpretation.labels,
    interpretationToken,
  });
}
