declare global {
  var __CHESSRIOT_ENV__: string | undefined;
  var __CHESSRIOT_OPS_READ_SECRET__: string | undefined;
  var __CHESSRIOT_OBSERVABILITY_HASH_SECRET__: string | undefined;
  var __CHESSRIOT_CONTROL_ORIGIN__: string | undefined;
  var __CHESSRIOT_ACCOUNT_ID_SECRET__: string | undefined;
  var __CHESSRIOT_SESSION_SIGNING_SECRET__: string | undefined;
  var __CHESSRIOT_TURNSTILE_SITE_KEY__: string | undefined;
  var __CHESSRIOT_TURNSTILE_SECRET_KEY__: string | undefined;
}

export function appEnvironment(): string {
  return globalThis.__CHESSRIOT_ENV__?.trim() || "local";
}

export function controlOrigin(): string {
  return globalThis.__CHESSRIOT_CONTROL_ORIGIN__?.trim()
    || "https://chessriot-control.ripper234.chatgpt.site";
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

export function sessionSigningSecret(): string | null {
  return globalThis.__CHESSRIOT_SESSION_SIGNING_SECRET__?.trim() || null;
}

export function turnstileSiteKey(): string | null {
  const configured = globalThis.__CHESSRIOT_TURNSTILE_SITE_KEY__?.trim();
  if (configured) return configured;
  return appEnvironment() === "local" || appEnvironment() === "test"
    ? "1x00000000000000000000AA"
    : null;
}

export function turnstileSecretKey(): string | null {
  return globalThis.__CHESSRIOT_TURNSTILE_SECRET_KEY__?.trim() || null;
}
