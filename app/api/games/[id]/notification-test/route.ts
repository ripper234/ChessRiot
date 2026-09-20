import { getDatabase } from "@/db";
import { authorizeGameRequest } from "@/lib/game-auth";
import { apiError, json } from "@/lib/http";
import { isPushEndpointHash } from "@/lib/push-notifications";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const auth = await authorizeGameRequest(request, id);
  if (!auth.ok) return apiError(auth.status, auth.code, auth.message);
  const endpointHash = new URL(request.url).searchParams.get("endpointHash");
  if (!auth.game.notification_test_device_id || !isPushEndpointHash(endpointHash)) {
    return apiError(404, "not_found", "Notification test not found");
  }
  const device = await getDatabase().prepare(`SELECT id, disabled_at, expiration_time FROM push_devices
    WHERE id = ? AND account_id = ? AND endpoint_hash = ?`)
    .bind(auth.game.notification_test_device_id, auth.account.id, endpointHash)
    .first<{ id: string; disabled_at: string | null; expiration_time: number | null }>();
  if (!device) return apiError(409, "wrong_device", "Open this test on the device where it was started");
  const rounds = await getDatabase().prepare(`SELECT game_version AS gameVersion, status,
      attempt_count AS attempts, created_at AS createdAt, updated_at AS updatedAt
    FROM push_turn_deliveries WHERE game_id = ? AND device_id = ?
    ORDER BY game_version LIMIT 4`).bind(id, device.id).all();
  return json({
    rounds: rounds.results,
    deviceEnabled: !device.disabled_at && (device.expiration_time === null || device.expiration_time > Date.now()),
    expiresAt: auth.game.notification_test_expires_at,
  });
}
