import { ensureSchema, getDatabase } from "@/db";
import type { GameRow } from "./game-store";
import { isAllowedPushEndpoint } from "./push-notifications";
import { pushEndpointHash } from "./push-client";

export async function notificationTestDevice(accountId: string, endpoint: unknown): Promise<{ id: string } | null> {
  if (!isAllowedPushEndpoint(endpoint)) return null;
  await ensureSchema();
  return await getDatabase().prepare(`SELECT id FROM push_devices
    WHERE account_id = ? AND endpoint_hash = ? AND endpoint = ?
      AND disabled_at IS NULL AND (expiration_time IS NULL OR expiration_time > ?)`)
    .bind(accountId, await pushEndpointHash(endpoint), endpoint, Date.now()).first<{ id: string }>();
}

export async function activeNotificationTestDevice(game: GameRow): Promise<{ id: string } | null> {
  if (!game.notification_test_device_id || (game.notification_test_expires_at ?? 0) <= Date.now()) return null;
  return await getDatabase().prepare(`SELECT devices.id FROM push_devices AS devices
    JOIN game_memberships AS memberships ON memberships.account_id = devices.account_id
    WHERE memberships.game_id = ? AND memberships.color = ? AND devices.id = ?
      AND devices.disabled_at IS NULL AND (devices.expiration_time IS NULL OR devices.expiration_time > ?)`)
    .bind(game.id, game.human_color, game.notification_test_device_id, Date.now()).first<{ id: string }>();
}
