declare global {
  var __CHESSRIOT_ENV__: string | undefined;
  var __CHESSRIOT_OPS_READ_SECRET__: string | undefined;
  var __CHESSRIOT_OBSERVABILITY_HASH_SECRET__: string | undefined;
  var __CHESSRIOT_CONTROL_ORIGIN__: string | undefined;
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
