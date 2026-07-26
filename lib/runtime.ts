declare global {
  var __CHESSRIOT_ENV__: string | undefined;
  var __CHESSRIOT_DEMO_BUCKET__: R2Bucket | undefined;
  var __CHESSRIOT_OPENAI_API_KEY__: string | undefined;
  var __CHESSRIOT_OPS_READ_SECRET__: string | undefined;
  var __CHESSRIOT_OBSERVABILITY_HASH_SECRET__: string | undefined;
  var __CHESSRIOT_CONTROL_ORIGIN__: string | undefined;
  var __CHESSRIOT_ACCOUNT_ID_SECRET__: string | undefined;
  var __CHESSRIOT_VIDEO_REGEN_SHARED_SECRET__: string | undefined;
}

export function appEnvironment(): string {
  return globalThis.__CHESSRIOT_ENV__?.trim() || "local";
}

export function controlOrigin(): string {
  return globalThis.__CHESSRIOT_CONTROL_ORIGIN__?.trim()
    || "https://chessriot-control.ripper234.chatgpt.site";
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
