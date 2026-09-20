import { ensureSchema, getDatabase } from "@/db";

const DAY_MS = 24 * 60 * 60 * 1_000;

export const TELEMETRY_RETENTION_DAYS = 30;

export function retentionCutoffs(nowMs = Date.now()): {
  telemetryBefore: string;
  pushDeliveryBefore: string;
  archiveExpiredBefore: string;
} {
  return {
    telemetryBefore: new Date(nowMs - TELEMETRY_RETENTION_DAYS * DAY_MS).toISOString(),
    pushDeliveryBefore: new Date(nowMs - TELEMETRY_RETENTION_DAYS * DAY_MS).toISOString(),
    archiveExpiredBefore: new Date(nowMs).toISOString(),
  };
}

/**
 * Apply the public retention policy on every API request. The sweep runs in the
 * request's background lifetime so it never blocks a player interaction.
 */
export async function enforceDataRetention(nowMs = Date.now()): Promise<void> {
  await ensureSchema();
  const database = getDatabase();
  const cutoffs = retentionCutoffs(nowMs);
  const inactivePushDeviceCutoff = new Date(nowMs - 180 * DAY_MS).toISOString();
  await database.batch([
    database.prepare("DELETE FROM observability_events WHERE occurred_at < ?")
      .bind(cutoffs.telemetryBefore),
    database.prepare("DELETE FROM push_deliveries WHERE created_at < ?")
      .bind(cutoffs.pushDeliveryBefore),
    database.prepare("DELETE FROM push_turn_deliveries WHERE created_at < ?")
      .bind(cutoffs.pushDeliveryBefore),
    database.prepare("DELETE FROM push_account_deliveries WHERE created_at < ?")
      .bind(cutoffs.pushDeliveryBefore),
    database.prepare(`DELETE FROM push_subscriptions
      WHERE (
          (expiration_time IS NOT NULL AND expiration_time <= ?)
          OR (disabled_at IS NOT NULL AND disabled_at < ?)
          OR EXISTS (
            SELECT 1 FROM games
            WHERE games.id = push_subscriptions.game_id
              AND games.status = 'completed'
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM push_deliveries AS deliveries
          WHERE deliveries.subscription_id = push_subscriptions.id
            AND deliveries.created_at >= ?
        )`)
      .bind(nowMs, cutoffs.pushDeliveryBefore, cutoffs.pushDeliveryBefore),
    database.prepare(`DELETE FROM push_devices
      WHERE (
          (expiration_time IS NOT NULL AND expiration_time <= ?)
          OR (disabled_at IS NOT NULL AND disabled_at < ?)
          OR (
            updated_at < ?
            AND (last_success_at IS NULL OR last_success_at < ?)
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM push_turn_deliveries AS deliveries
          WHERE deliveries.device_id = push_devices.id
            AND deliveries.created_at >= ?
        )
        AND NOT EXISTS (
          SELECT 1 FROM push_account_deliveries AS deliveries
          WHERE deliveries.device_id = push_devices.id
            AND deliveries.created_at >= ?
        )`)
      .bind(
        nowMs,
        cutoffs.pushDeliveryBefore,
        inactivePushDeviceCutoff,
        inactivePushDeviceCutoff,
        cutoffs.pushDeliveryBefore,
        cutoffs.pushDeliveryBefore,
      ),
    database.prepare("DELETE FROM ops_action_nonces WHERE expires_at <= ?")
      .bind(nowMs),
    database.prepare("DELETE FROM safety_report_archive WHERE expires_at < ?")
      .bind(cutoffs.archiveExpiredBefore),
  ]);
}
