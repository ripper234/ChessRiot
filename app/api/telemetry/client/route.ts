import { requestIsSameOrigin } from "@/lib/validation";
import { enforcePublicRateLimit } from "@/lib/public-rate-limit";

export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
  "client.error",
  "client.unhandled_rejection",
  "client.network_error",
  "public.home_viewed",
  "demo.started",
  "demo.completed",
  "auth.started",
  "tutorial.started",
  "tutorial.completed",
  "tutorial.skipped",
  "activity.opened",
]);
const ERROR_EVENTS = new Set([
  "client.error",
  "client.unhandled_rejection",
  "client.network_error",
]);

export async function POST(request: Request) {
  if (!requestIsSameOrigin(request)) return new Response(null, { status: 403 });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return new Response(null, { status: 400 });
    }
    const payload = body as { requestId?: unknown; event?: unknown; code?: unknown; gameId?: unknown };
    if (
      typeof payload.requestId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.requestId)
      || typeof payload.event !== "string"
      || !ALLOWED_EVENTS.has(payload.event)
      || (ERROR_EVENTS.has(payload.event) && (
        typeof payload.code !== "string"
        || payload.code.length < 1
        || payload.code.length > 80
      ))
      || (!ERROR_EVENTS.has(payload.event) && payload.code !== undefined)
      || payload.gameId !== undefined
    ) {
      return new Response(null, { status: 400 });
    }
    const rate = await enforcePublicRateLimit(request, "client_telemetry", 60, 60);
    if (!rate.allowed) {
      return new Response(null, {
        status: 429,
        headers: { "retry-after": String(rate.retryAfter) },
      });
    }
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return new Response(null, { status: 400 });
  }
}
