import { requestIsSameOrigin } from "@/lib/validation";

export const dynamic = "force-dynamic";

const ALLOWED_EVENTS = new Set([
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
    const payload = body as { event?: unknown; code?: unknown; gameId?: unknown };
    if (
      typeof payload.event !== "string"
      || !ALLOWED_EVENTS.has(payload.event)
      || typeof payload.code !== "string"
      || payload.code.length < 1
      || payload.code.length > 80
      || (
        payload.gameId !== undefined
        && (
          typeof payload.gameId !== "string"
          || !/^[0-9a-f-]{36}$/i.test(payload.gameId)
        )
      )
    ) {
      return new Response(null, { status: 400 });
    }
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return new Response(null, { status: 400 });
  }
}
