import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  observeHttpRequest,
  prepareRequestObservation,
  recordEvent,
  sanitizeObservedRoute,
} from "@/lib/observability";
import { deliverCommittedTurnNotification } from "@/lib/push-notifications";

interface Env {
  ASSETS: Fetcher;
  BUCKET: R2Bucket;
  DB: D1Database;
  CHESSRIOT_ENV?: string;
  APP_ORIGIN?: string;
  CONTROL_ORIGIN?: string;
  OPENAI_API_KEY?: string;
  OBSERVABILITY_HASH_SECRET?: string;
  OPS_READ_SECRET?: string;
  ACCOUNT_ID_SECRET?: string;
  VIDEO_REGEN_SHARED_SECRET?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
  VAPID_SUBJECT?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function hardenResponse(response: Response, url: URL): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  if (url.protocol === "https:" && (url.hostname === "chessriot.gg" || url.hostname.endsWith(".chessriot.gg"))) {
    // Start conservatively while custom Dev and Control hostnames complete TLS
    // activation. Extend the duration only after every subdomain is verified.
    headers.set("strict-transport-security", "max-age=86400");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    globalThis.__CHESSRIOT_DB__ = env.DB;
    globalThis.__CHESSRIOT_ENV__ = env.CHESSRIOT_ENV;
    globalThis.__CHESSRIOT_APP_ORIGIN__ = env.APP_ORIGIN;
    globalThis.__CHESSRIOT_CONTROL_ORIGIN__ = env.CONTROL_ORIGIN;
    globalThis.__CHESSRIOT_DEMO_BUCKET__ = env.BUCKET;
    globalThis.__CHESSRIOT_OPENAI_API_KEY__ = env.OPENAI_API_KEY;
    globalThis.__CHESSRIOT_OBSERVABILITY_HASH_SECRET__ = env.OBSERVABILITY_HASH_SECRET;
    globalThis.__CHESSRIOT_OPS_READ_SECRET__ = env.OPS_READ_SECRET;
    globalThis.__CHESSRIOT_ACCOUNT_ID_SECRET__ = env.ACCOUNT_ID_SECRET;
    globalThis.__CHESSRIOT_VIDEO_REGEN_SHARED_SECRET__ = env.VIDEO_REGEN_SHARED_SECRET;
    globalThis.__CHESSRIOT_VAPID_PUBLIC_KEY__ = env.VAPID_PUBLIC_KEY;
    globalThis.__CHESSRIOT_VAPID_PRIVATE_JWK__ = env.VAPID_PRIVATE_JWK;
    globalThis.__CHESSRIOT_VAPID_SUBJECT__ = env.VAPID_SUBJECT;
    const url = new URL(request.url);
    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      const imageResponse = await handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
      return hardenResponse(imageResponse, url);
    }
    const startedAt = performance.now();
    const observation = url.pathname.startsWith("/api/")
      && url.pathname !== "/api/demo-video/publish"
      ? prepareRequestObservation(request)
      : null;
    try {
      const response = hardenResponse(await handler.fetch(request, env, ctx), url);
      if (response.headers.get("x-chessriot-turn-committed") === "1") {
        ctx.waitUntil(deliverCommittedTurnNotification(response.clone()));
      }
      if (observation) {
        ctx.waitUntil(observeHttpRequest(request, response, startedAt, observation));
      }
      return response;
    } catch (error) {
      ctx.waitUntil(recordEvent({
        event: "error.unhandled",
        outcome: "failure",
        route: sanitizeObservedRoute(url.pathname),
        method: request.method,
        statusCode: 500,
        errorCode: error instanceof Error ? error.name : "unknown_error",
        latencyMs: performance.now() - startedAt,
      }));
      throw error;
    }
  },
};

export default worker;
