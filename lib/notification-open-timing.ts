const CACHE_NAME = "chessriot-notification-timing-v1";
const MAX_AGE_MS = 2 * 60_000;

export type NotificationOpenMode = "same-game" | "existing-window" | "new-window";

interface NotificationTap {
  clickedAt: number;
  gameVersion: number | null;
  mode: NotificationOpenMode;
}

export interface NotificationBoardTiming {
  elapsedMs: number;
  mode: NotificationOpenMode;
}

function isNotificationTap(value: unknown): value is NotificationTap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const tap = value as Partial<NotificationTap>;
  return Number.isSafeInteger(tap.clickedAt)
    && (tap.gameVersion === null || Number.isSafeInteger(tap.gameVersion))
    && ["same-game", "existing-window", "new-window"].includes(tap.mode ?? "");
}

function receiptPath(gameId: string): string {
  return `/__chessriot_notification_timing__/${encodeURIComponent(gameId)}`;
}

/**
 * The worker writes only a timestamp and route category. This read is allowed
 * only after AccountGate and an authoritative, account-scoped game response.
 */
export async function readNotificationTap(
  gameId: string,
  currentVersion: number,
  now = Date.now(),
): Promise<NotificationTap | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(receiptPath(gameId));
    if (!response) return null;
    const value: unknown = await response.json();
    if (!isNotificationTap(value) || value.clickedAt > now || now - value.clickedAt > MAX_AGE_MS) {
      await cache.delete(receiptPath(gameId));
      return null;
    }
    if (value.gameVersion !== null && currentVersion < value.gameVersion) return null;
    return value;
  } catch {
    return null;
  }
}

export async function finishNotificationBoardTiming(
  gameId: string,
  tap: NotificationTap,
  paintedAt: number,
): Promise<NotificationBoardTiming | null> {
  if (paintedAt < tap.clickedAt || paintedAt - tap.clickedAt > MAX_AGE_MS) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(receiptPath(gameId));
    const current: unknown = response ? await response.json() : null;
    if (!isNotificationTap(current) || current.clickedAt !== tap.clickedAt) return null;
    await cache.delete(receiptPath(gameId));
    return { elapsedMs: paintedAt - tap.clickedAt, mode: tap.mode };
  } catch {
    return null;
  }
}
