import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { initializeRuntimeInvariants } from "@/db";
import {
  observeHttpRequest,
  prepareRequestObservation,
  recordEvent,
  sanitizeObservedRoute,
} from "@/lib/observability";
import { enforceDataRetention } from "@/lib/data-retention";
import {
  drainPendingAccountNotifications,
  drainPendingTurnNotifications,
} from "@/lib/push-notifications";
import { runBoundedPushDrain } from "@/lib/push-drain";
import { playPendingComputerTurn } from "@/lib/computer-turn";
import { isUuid } from "@/lib/validation";
import {
  GOOGLE_SESSION_COOKIE,
  refreshedGoogleSessionCookieFromHeaders,
} from "@/lib/google-auth";

interface Env {
  ASSETS: Fetcher;
  BUCKET: R2Bucket;
  DB: D1Database;
  CHESSRIOT_ENV?: string;
  APP_ORIGIN?: string;
  CONTROL_ORIGIN?: string;
  OPENAI_API_KEY?: string;
  OPENAI_API_KEY_DEV?: string;
  OPENAI_API_KEY_PROD?: string;
  GOOGLE_CLIENT_ID_DEV?: string;
  GOOGLE_CLIENT_ID_PROD?: string;
  GOOGLE_CLIENT_SECRET_DEV?: string;
  GOOGLE_CLIENT_SECRET_PROD?: string;
  GOOGLE_AUTH_SESSION_SECRET_DEV?: string;
  GOOGLE_AUTH_SESSION_SECRET_PROD?: string;
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

function schedulePushDrain(ctx: ExecutionContext): void {
  ctx.waitUntil((async () => {
    try {
      await runBoundedPushDrain(
        drainPendingTurnNotifications,
        drainPendingAccountNotifications,
        {
          onLaneError: (lane, error) => {
            console.error(JSON.stringify({
              type: "chessriot_push_lane_failure",
              lane,
              errorType: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
            }));
          },
        },
      );
    } catch (error) {
      console.error(JSON.stringify({
        type: "chessriot_push_drain_failure",
        errorType: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
      }));
    }
  })());
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

function userActivityPath(pathname: string): boolean {
  return pathname.startsWith("/api/")
    || (!pathname.startsWith("/_") && !/\.[A-Za-z0-9]{1,8}$/.test(pathname));
}

async function renewActiveGoogleSession(
  request: Request,
  response: Response,
  url: URL,
): Promise<Response> {
  const setCookie = response.headers.get("set-cookie") ?? "";
  if (
    !response.ok
    || !userActivityPath(url.pathname)
    || url.pathname === "/api/auth/google/callback"
    || url.pathname === "/api/auth/signout"
    || (url.pathname === "/api/me/account" && request.method === "DELETE")
    || setCookie.includes(`${GOOGLE_SESSION_COOKIE}=`)
  ) return response;
  const renewed = await refreshedGoogleSessionCookieFromHeaders(request.headers);
  if (!renewed) return response;
  const headers = new Headers(response.headers);
  headers.append("set-cookie", renewed);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function bindRuntimeEnvironment(env: Env): void {
  globalThis.__CHESSRIOT_DB__ = env.DB;
  globalThis.__CHESSRIOT_ENV__ = env.CHESSRIOT_ENV;
  globalThis.__CHESSRIOT_APP_ORIGIN__ = env.APP_ORIGIN;
  globalThis.__CHESSRIOT_CONTROL_ORIGIN__ = env.CONTROL_ORIGIN;
  globalThis.__CHESSRIOT_DEMO_BUCKET__ = env.BUCKET;
  globalThis.__CHESSRIOT_OPENAI_API_KEY__ = env.OPENAI_API_KEY;
  globalThis.__CHESSRIOT_OPENAI_API_KEY_DEV__ = env.OPENAI_API_KEY_DEV;
  globalThis.__CHESSRIOT_OPENAI_API_KEY_PROD__ = env.OPENAI_API_KEY_PROD;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_ID_DEV__ = env.GOOGLE_CLIENT_ID_DEV;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_ID_PROD__ = env.GOOGLE_CLIENT_ID_PROD;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_SECRET_DEV__ = env.GOOGLE_CLIENT_SECRET_DEV;
  globalThis.__CHESSRIOT_GOOGLE_CLIENT_SECRET_PROD__ = env.GOOGLE_CLIENT_SECRET_PROD;
  globalThis.__CHESSRIOT_GOOGLE_AUTH_SESSION_SECRET_DEV__ = env.GOOGLE_AUTH_SESSION_SECRET_DEV;
  globalThis.__CHESSRIOT_GOOGLE_AUTH_SESSION_SECRET_PROD__ = env.GOOGLE_AUTH_SESSION_SECRET_PROD;
  globalThis.__CHESSRIOT_OBSERVABILITY_HASH_SECRET__ = env.OBSERVABILITY_HASH_SECRET;
  globalThis.__CHESSRIOT_OPS_READ_SECRET__ = env.OPS_READ_SECRET;
  globalThis.__CHESSRIOT_ACCOUNT_ID_SECRET__ = env.ACCOUNT_ID_SECRET;
  globalThis.__CHESSRIOT_VIDEO_REGEN_SHARED_SECRET__ = env.VIDEO_REGEN_SHARED_SECRET;
  globalThis.__CHESSRIOT_VAPID_PUBLIC_KEY__ = env.VAPID_PUBLIC_KEY;
  globalThis.__CHESSRIOT_VAPID_PRIVATE_JWK__ = env.VAPID_PRIVATE_JWK;
  globalThis.__CHESSRIOT_VAPID_SUBJECT__ = env.VAPID_SUBJECT;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    bindRuntimeEnvironment(env);
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
    const readOnlyHealth = url.pathname === "/api/health";
    if (env.DB && request.method === "GET" && url.pathname === "/") {
      ctx.waitUntil(initializeRuntimeInvariants().catch((error) => {
        console.error(JSON.stringify({
          type: "chessriot_runtime_continuity_failure",
          errorType: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
        }));
      }));
    }
    if (env.DB && url.pathname.startsWith("/api/") && !readOnlyHealth) {
      ctx.waitUntil(enforceDataRetention().catch((error) => {
        console.error(JSON.stringify({
          type: "chessriot_retention_failure",
          errorType: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
        }));
      }));
    }
    const observation = url.pathname.startsWith("/api/")
      && !readOnlyHealth
      && url.pathname !== "/api/demo-video/publish"
      ? prepareRequestObservation(request)
      : null;
    try {
      const hardened = hardenResponse(await handler.fetch(request, env, ctx), url);
      const response = await renewActiveGoogleSession(request, hardened, url);
      const testVersion = response.headers.get("x-chessriot-notification-test-version");
      const testGameId = /^\/api\/games\/([^/]+)\/moves$/.exec(url.pathname)?.[1];
      if (env.DB && response.ok && request.method === "POST" && isUuid(testGameId)
        && testVersion !== null && Number.isSafeInteger(Number(testVersion)) && Number(testVersion) > 0) {
        const testStartedAt = Date.now();
        ctx.waitUntil((async () => {
          try {
            await new Promise((resolve) => setTimeout(resolve, 8_000));
            await playPendingComputerTurn(testGameId, Number(testVersion));
            await runBoundedPushDrain(drainPendingTurnNotifications, drainPendingAccountNotifications, { startedAt: testStartedAt });
          } catch {
            await recordEvent({ event: "push.notification_test_failed", outcome: "failure", errorCode: "delayed_turn_failed" });
          }
        })());
      } else if (env.DB && url.pathname.startsWith("/api/") && !readOnlyHealth) schedulePushDrain(ctx);
      if (observation) {
        ctx.waitUntil(observeHttpRequest(request, response, startedAt, observation));
      }
      return response;
    } catch (error) {
      if (env.DB && url.pathname.startsWith("/api/") && !readOnlyHealth) schedulePushDrain(ctx);
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
  async scheduled(
    _controller: { scheduledTime: number; cron: string },
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    bindRuntimeEnvironment(env);
    schedulePushDrain(ctx);
  },
};

export default worker;
