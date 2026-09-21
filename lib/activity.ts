import { ensureSchema, getDatabase } from "@/db";
import { expireAccountMultiplayerTurns } from "./game-store";
import type { TurnPaceDays } from "./game-types";

export type ActivityKind = "friend_request" | "challenge" | "turn" | "result";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  createdAt: string;
  unread: boolean;
  href: string | null;
  requestId: string | null;
  gameId: string | null;
  username: string | null;
  openingPlayed: boolean;
  turnPaceDays: TurnPaceDays | null;
}

export interface ActivitySummary {
  items: ActivityItem[];
  unreadCount: number;
  snapshotAt: string;
}

type NotificationSeed = {
  recipientAccountId: string;
  actorAccountId: string | null;
  gameId: string | null;
  kind: ActivityKind;
  sourceKey: string;
  createdAt: string;
};

async function seedNotifications(seeds: NotificationSeed[]): Promise<void> {
  if (!seeds.length) return;
  const database = getDatabase();
  for (let offset = 0; offset < seeds.length; offset += 100) {
    await database.batch(seeds.slice(offset, offset + 100).map((seed) => database
      .prepare(`INSERT OR IGNORE INTO account_notifications (
        id, recipient_account_id, actor_account_id, game_id, kind, source_key,
        created_at, read_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`)
      .bind(
        crypto.randomUUID(),
        seed.recipientAccountId,
        seed.actorAccountId,
        seed.gameId,
        seed.kind,
        seed.sourceKey,
        seed.createdAt,
      )));
  }
}

export async function syncAccountActivity(accountId: string): Promise<void> {
  await expireAccountMultiplayerTurns(accountId);
  await ensureSchema();
  const database = getDatabase();
  const [requests, games] = await Promise.all([
    database.prepare(`SELECT id, sender_account_id, created_at
      FROM friend_requests
      WHERE recipient_account_id = ? AND status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM account_blocks
          WHERE (blocker_account_id = ? AND blocked_account_id = sender_account_id)
             OR (blocker_account_id = sender_account_id AND blocked_account_id = ?)
        )
      ORDER BY created_at DESC LIMIT 50`)
      .bind(accountId, accountId, accountId)
      .all<{ id: string; sender_account_id: string; created_at: string }>(),
    database.prepare(`SELECT games.id, games.status, games.version, games.turn_color,
        games.updated_at, games.finished_at, mine.color,
        other.account_id AS other_account_id
      FROM game_memberships AS mine
      JOIN games ON games.id = mine.game_id
      LEFT JOIN game_memberships AS other
        ON other.game_id = mine.game_id AND other.account_id <> mine.account_id
      WHERE mine.account_id = ?
        AND (games.status <> 'completed' OR games.finished_at >= ?)
        AND (other.account_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM account_blocks
          WHERE (blocker_account_id = ? AND blocked_account_id = other.account_id)
             OR (blocker_account_id = other.account_id AND blocked_account_id = ?)
        ))
      ORDER BY games.updated_at DESC LIMIT 60`)
      .bind(
        accountId,
        new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString(),
        accountId,
        accountId,
      )
      .all<{
        id: string;
        status: "waiting" | "active" | "completed";
        version: number;
        turn_color: "w" | "b";
        updated_at: string;
        finished_at: string | null;
        color: "w" | "b";
        other_account_id: string | null;
      }>(),
  ]);

  const seeds: NotificationSeed[] = (requests.results ?? []).map((row) => ({
    recipientAccountId: accountId,
    actorAccountId: row.sender_account_id,
    gameId: null,
    kind: "friend_request",
    sourceKey: `friend_request:${row.id}`,
    createdAt: row.created_at,
  }));
  for (const game of games.results ?? []) {
    if (game.status === "waiting" && game.color === "b" && game.other_account_id) {
      seeds.push({
        recipientAccountId: accountId,
        actorAccountId: game.other_account_id,
        gameId: game.id,
        kind: "challenge",
        sourceKey: `challenge:${game.id}`,
        createdAt: game.updated_at,
      });
    } else if (game.status === "active" && game.turn_color === game.color) {
      seeds.push({
        recipientAccountId: accountId,
        actorAccountId: game.other_account_id,
        gameId: game.id,
        kind: "turn",
        sourceKey: `turn:${game.id}:${game.version}`,
        createdAt: game.updated_at,
      });
    } else if (game.status === "completed") {
      seeds.push({
        recipientAccountId: accountId,
        actorAccountId: game.other_account_id,
        gameId: game.id,
        kind: "result",
        sourceKey: `result:${game.id}:${game.version}`,
        createdAt: game.finished_at ?? game.updated_at,
      });
    }
  }
  const currentTurnSources = seeds
    .filter((seed) => seed.kind === "turn")
    .map((seed) => seed.sourceKey);
  if (currentTurnSources.length) {
    await database.prepare(`DELETE FROM account_notifications
      WHERE recipient_account_id = ? AND kind = 'turn'
        AND source_key NOT IN (${currentTurnSources.map(() => "?").join(",")})`)
      .bind(accountId, ...currentTurnSources)
      .run();
  } else {
    await database.prepare("DELETE FROM account_notifications WHERE recipient_account_id = ? AND kind = 'turn'")
      .bind(accountId)
      .run();
  }
  await database.prepare(`DELETE FROM account_notifications
    WHERE recipient_account_id = ? AND kind = 'challenge'
      AND game_id IN (SELECT id FROM games WHERE status <> 'waiting')`)
    .bind(accountId)
    .run();
  await database.prepare(`DELETE FROM account_notifications
    WHERE recipient_account_id = ? AND kind = 'friend_request'
      AND NOT EXISTS (
        SELECT 1 FROM friend_requests
        WHERE account_notifications.source_key = 'friend_request:' || friend_requests.id
          AND friend_requests.recipient_account_id = ?
          AND friend_requests.status = 'pending'
      )`)
    .bind(accountId, accountId)
    .run();
  await seedNotifications(seeds);
}

function resultDetail(
  ownColor: string | null,
  winnerColor: string | null,
  termination: string | null,
): string {
  if (!winnerColor) return termination === "cancelled" ? "Game cancelled" : "Draw";
  return winnerColor === ownColor ? "You won" : "You lost";
}

export async function listActivity(accountId: string): Promise<ActivitySummary> {
  await syncAccountActivity(accountId);
  const database = getDatabase();
  const snapshotAt = new Date().toISOString();
  const [rows, unread] = await Promise.all([
    database.prepare(`SELECT notifications.id, notifications.kind,
        notifications.source_key, notifications.created_at, notifications.read_at,
        notifications.game_id, actor.username AS actor_username,
        games.status AS game_status, games.winner_color, games.termination, games.ply_count,
        settings.turn_pace_days,
        mine.color AS own_color, friend_requests.status AS request_status
      FROM account_notifications AS notifications
      LEFT JOIN accounts AS actor ON actor.id = notifications.actor_account_id
      LEFT JOIN games ON games.id = notifications.game_id
      LEFT JOIN game_settings AS settings ON settings.game_id = notifications.game_id
      LEFT JOIN game_memberships AS mine
        ON mine.game_id = notifications.game_id
        AND mine.account_id = notifications.recipient_account_id
      LEFT JOIN friend_requests
        ON notifications.source_key = 'friend_request:' || friend_requests.id
      WHERE notifications.recipient_account_id = ?
        AND notifications.created_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM account_blocks AS blocks
          WHERE (blocks.blocker_account_id = notifications.recipient_account_id
            AND blocks.blocked_account_id = notifications.actor_account_id)
             OR (blocks.blocker_account_id = notifications.actor_account_id
            AND blocks.blocked_account_id = notifications.recipient_account_id)
        )
      ORDER BY notifications.created_at DESC, notifications.id DESC
      LIMIT 40`)
      .bind(accountId, snapshotAt)
      .all<{
        id: string;
        kind: ActivityKind;
        source_key: string;
        created_at: string;
        read_at: string | null;
        game_id: string | null;
        actor_username: string | null;
        winner_color: string | null;
        termination: string | null;
        turn_pace_days: TurnPaceDays | null;
        own_color: string | null;
        game_status: string | null;
        ply_count: number | null;
        request_status: string | null;
      }>(),
    database.prepare(`SELECT COUNT(*) AS count FROM account_notifications
      WHERE recipient_account_id = ? AND read_at IS NULL AND created_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM account_blocks AS blocks
          WHERE (blocks.blocker_account_id = account_notifications.recipient_account_id
            AND blocks.blocked_account_id = account_notifications.actor_account_id)
             OR (blocks.blocker_account_id = account_notifications.actor_account_id
            AND blocks.blocked_account_id = account_notifications.recipient_account_id)
        )`)
      .bind(accountId, snapshotAt)
      .first<{ count: number }>(),
  ]);

  const items = (rows.results ?? []).map((row): ActivityItem => {
    const username = row.actor_username;
    const actor = username ? `@${username}` : "A player";
    const requestId = row.kind === "friend_request" && row.request_status === "pending"
      ? row.source_key.slice("friend_request:".length)
      : null;
    const pace = row.turn_pace_days
      ? `${row.turn_pace_days} ${row.turn_pace_days === 1 ? "day" : "days"} per move`
      : null;
    const openingPlayed = row.kind === "challenge" && row.game_status === "waiting" && Number(row.ply_count) > 0;
    const copy = row.kind === "friend_request"
      ? { title: "Friend request", detail: `${actor} wants to connect.` }
      : row.kind === "challenge"
        ? { title: "New challenge", detail: `${actor} challenged you${pace ? ` · ${pace}` : ""}. ${openingPlayed ? "White has played the opening. Your turn starts when you accept." : "White moves first."}` }
        : row.kind === "turn"
          ? { title: "Your turn", detail: username ? `Play your move against ${actor}.` : "Play your next move." }
          : { title: "Game finished", detail: resultDetail(row.own_color, row.winner_color, row.termination) };
    return {
      id: row.id,
      kind: row.kind,
      title: copy.title,
      detail: copy.detail,
      createdAt: row.created_at,
      unread: row.read_at === null,
      href: row.game_id ? `/g/${row.game_id}` : null,
      requestId,
      gameId: row.kind === "challenge" && row.game_status !== "waiting" ? null : row.game_id,
      username,
      openingPlayed,
      turnPaceDays: row.turn_pace_days,
    };
  });
  return { items, unreadCount: Number(unread?.count ?? 0), snapshotAt };
}

export async function markActivityRead(accountId: string, snapshotAt: string): Promise<void> {
  if (!Number.isFinite(Date.parse(snapshotAt)) || snapshotAt > new Date().toISOString()) {
    throw new Error("invalid_snapshot");
  }
  await ensureSchema();
  const database = getDatabase();
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`UPDATE account_notifications SET read_at = ?
      WHERE recipient_account_id = ? AND read_at IS NULL AND created_at <= ?`)
      .bind(now, accountId, snapshotAt),
    database.prepare(`DELETE FROM account_notifications
      WHERE recipient_account_id = ? AND read_at IS NOT NULL AND created_at < ?`)
      .bind(accountId, new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString()),
  ]);
}
