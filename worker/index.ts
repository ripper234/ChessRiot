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
} from "@/lib/observability";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  CHESSRIOT_ENV?: string;
  CONTROL_ORIGIN?: string;
  OBSERVABILITY_HASH_SECRET?: string;
  OPS_READ_SECRET?: string;
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

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    globalThis.__CHESSRIOT_DB__ = env.DB;
    globalThis.__CHESSRIOT_ENV__ = env.CHESSRIOT_ENV;
    globalThis.__CHESSRIOT_CONTROL_ORIGIN__ = env.CONTROL_ORIGIN;
    globalThis.__CHESSRIOT_OBSERVABILITY_HASH_SECRET__ = env.OBSERVABILITY_HASH_SECRET;
    globalThis.__CHESSRIOT_OPS_READ_SECRET__ = env.OPS_READ_SECRET;
    const url = new URL(request.url);
    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
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
    }
    const startedAt = performance.now();
    const observation = url.pathname.startsWith("/api/")
      ? prepareRequestObservation(request)
      : null;
    try {
      const response = await handler.fetch(request, env, ctx);
      if (observation) {
        ctx.waitUntil(observeHttpRequest(request, response, startedAt, observation));
      }
      return response;
    } catch (error) {
      ctx.waitUntil(recordEvent({
        event: "error.unhandled",
        outcome: "failure",
        route: url.pathname.replace(
          /^\/api\/games\/[^/]+/,
          "/api/games/:id",
        ).replace(
          /^\/api\/invitations\/[^/]+/,
          "/api/invitations/:token",
        ),
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
