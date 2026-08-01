declare global {
  var __CHESSRIOT_ENV__: string | undefined;
  var __CHESSRIOT_APP_ORIGIN__: string | undefined;
  var __CHESSRIOT_DEMO_BUCKET__: R2Bucket | undefined;
  var __CHESSRIOT_OPENAI_API_KEY__: string | undefined;
  var __CHESSRIOT_OPS_READ_SECRET__: string | undefined;
  var __CHESSRIOT_OBSERVABILITY_HASH_SECRET__: string | undefined;
  var __CHESSRIOT_CONTROL_ORIGIN__: string | undefined;
  var __CHESSRIOT_ACCOUNT_ID_SECRET__: string | undefined;
  var __CHESSRIOT_VIDEO_REGEN_SHARED_SECRET__: string | undefined;
  var __CHESSRIOT_VAPID_PUBLIC_KEY__: string | undefined;
  var __CHESSRIOT_VAPID_PRIVATE_JWK__: string | undefined;
  var __CHESSRIOT_VAPID_SUBJECT__: string | undefined;
}

export function appEnvironment(): string {
  return globalThis.__CHESSRIOT_ENV__?.trim() || "local";
}

export function controlOrigin(): string {
  return validOrigin(
    globalThis.__CHESSRIOT_CONTROL_ORIGIN__,
    isHostedEnvironment(),
  ) ?? "https://control.chessriot.gg";
}

function isHostedEnvironment(): boolean {
  const environment = appEnvironment();
  return environment === "development" || environment === "production";
}

function validOrigin(value: string | undefined, requireHttps = false): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.origin !== value.trim() || !["https:", "http:"].includes(url.protocol)) return null;
    if (requireHttps && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function configuredAppOrigin(): string | null {
  return validOrigin(globalThis.__CHESSRIOT_APP_ORIGIN__, isHostedEnvironment());
}

export function applicationOrigin(request: Request): string {
  return configuredAppOrigin() ?? new URL(request.url).origin;
}

export function runtimeReadiness() {
  const hosted = isHostedEnvironment();
  const appOriginReady = configuredAppOrigin() !== null;
  const controlOriginReady = validOrigin(
    globalThis.__CHESSRIOT_CONTROL_ORIGIN__,
    hosted,
  ) !== null;
  const accountIdentityReady = (accountIdSecret()?.length ?? 0) >= 32;
  const observabilityReady = (observabilityHashSecret()?.length ?? 0) >= 32;
  return {
    core: !hosted || (
      appOriginReady
      && controlOriginReady
      && accountIdentityReady
      && observabilityReady
    ),
    configuration: {
      appOrigin: appOriginReady,
      controlOrigin: controlOriginReady,
      accountIdentity: accountIdentityReady,
      observability: observabilityReady,
    },
    capabilities: {
      operations: (opsReadSecret()?.length ?? 0) >= 32,
      push: Boolean(vapidPublicKey() && vapidPrivateJwk() && vapidSubject()),
      demoNarration: Boolean(demoVideoBucket() && openAiApiKey() && videoRegenSharedSecret()),
    },
  };
}

export function demoVideoBucket(): R2Bucket | null {
  return globalThis.__CHESSRIOT_DEMO_BUCKET__ ?? null;
}

export function openAiApiKey(): string | null {
  return globalThis.__CHESSRIOT_OPENAI_API_KEY__?.trim() || null;
}

export function opsReadSecret(): string | null {
  return globalThis.__CHESSRIOT_OPS_READ_SECRET__?.trim() || null;
}

export function observabilityHashSecret(): string | null {
  return globalThis.__CHESSRIOT_OBSERVABILITY_HASH_SECRET__?.trim() || null;
}

export function accountIdSecret(): string | null {
  return globalThis.__CHESSRIOT_ACCOUNT_ID_SECRET__?.trim() || null;
}

export function videoRegenSharedSecret(): string | null {
  return globalThis.__CHESSRIOT_VIDEO_REGEN_SHARED_SECRET__?.trim() || null;
}

export function vapidPublicKey(): string | null {
  return globalThis.__CHESSRIOT_VAPID_PUBLIC_KEY__?.trim() || null;
}

export function vapidPrivateJwk(): string | null {
  return globalThis.__CHESSRIOT_VAPID_PRIVATE_JWK__?.trim() || null;
}

export function vapidSubject(): string | null {
  return globalThis.__CHESSRIOT_VAPID_SUBJECT__?.trim() || null;
}
