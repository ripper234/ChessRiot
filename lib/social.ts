import { ensureSchema, getDatabase } from "@/db";
import {
  findAccountByUsername,
  getAccountProfile,
  type AccountProfile,
} from "./accounts";
import { queueFriendRequestNotifications } from "./push-notifications";
export { MAGIC_RULES_FEATURE } from "./feature-access";

export interface SocialPerson {
  username: string;
}

export interface FriendRequestSummary extends SocialPerson {
  id: string;
  createdAt: string;
}

export interface SocialSummary {
  friends: SocialPerson[];
  incoming: FriendRequestSummary[];
  outgoing: FriendRequestSummary[];
}

type FriendRequestRow = {
  id: string;
  sender_account_id: string;
  recipient_account_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  sender_username: string;
  recipient_username: string;
};

export type SendFriendRequestResult =
  | { ok: true; state: "sent" | "already_friends"; requestId: string | null }
  | {
      ok: false;
      code: "not_found" | "self" | "incoming_exists" | "invalid_account" | "blocked";
      message: string;
    };

export type RespondFriendRequestResult =
  | { ok: true; status: "accepted" | "declined" }
  | { ok: false; code: "not_found" | "settled"; message: string };

export function friendPairKey(leftAccountId: string, rightAccountId: string): string {
  return [leftAccountId, rightAccountId].sort().join(":");
}

export async function accountsAreBlocked(
  leftAccountId: string,
  rightAccountId: string,
): Promise<boolean> {
  await ensureSchema();
  return Boolean(await getDatabase()
    .prepare(`SELECT blocker_account_id FROM account_blocks
      WHERE (blocker_account_id = ? AND blocked_account_id = ?)
         OR (blocker_account_id = ? AND blocked_account_id = ?)
      LIMIT 1`)
    .bind(leftAccountId, rightAccountId, rightAccountId, leftAccountId)
    .first<{ blocker_account_id: string }>());
}

export async function gameOpponentIsBlocked(
  gameId: string,
  accountId: string,
): Promise<boolean> {
  await ensureSchema();
  const opponent = await getDatabase()
    .prepare(`SELECT account_id FROM game_memberships
      WHERE game_id = ? AND account_id <> ? LIMIT 1`)
    .bind(gameId, accountId)
    .first<{ account_id: string }>();
  return opponent ? accountsAreBlocked(accountId, opponent.account_id) : false;
}

function settledFriendRequestSend(
  request: FriendRequestRow | null,
  senderAccountId: string,
  recipientUsername: string,
): SendFriendRequestResult | null {
  if (request?.status === "accepted") {
    return { ok: true, state: "already_friends", requestId: request.id };
  }
  if (request?.status === "pending" && request.sender_account_id === senderAccountId) {
    return { ok: true, state: "sent", requestId: request.id };
  }
  if (request?.status === "pending") {
    return {
      ok: false,
      code: "incoming_exists",
      message: `${recipientUsername} already sent you a request. Accept it below.`,
    };
  }
  return null;
}

async function friendRequestForPair(
  leftAccountId: string,
  rightAccountId: string,
): Promise<FriendRequestRow | null> {
  await ensureSchema();
  return (await getDatabase()
    .prepare(`SELECT requests.*,
        sender.username AS sender_username,
        recipient.username AS recipient_username
      FROM friend_requests AS requests
      JOIN accounts AS sender ON sender.id = requests.sender_account_id
      JOIN accounts AS recipient ON recipient.id = requests.recipient_account_id
      WHERE requests.pair_key = ?`)
    .bind(friendPairKey(leftAccountId, rightAccountId))
    .first<FriendRequestRow>()) ?? null;
}

export async function listSocialSummary(accountId: string): Promise<SocialSummary> {
  await ensureSchema();
  const result = await getDatabase()
    .prepare(`SELECT requests.*,
        sender.username AS sender_username,
        recipient.username AS recipient_username
      FROM friend_requests AS requests
      JOIN accounts AS sender ON sender.id = requests.sender_account_id
      JOIN accounts AS recipient ON recipient.id = requests.recipient_account_id
      WHERE (requests.sender_account_id = ? OR requests.recipient_account_id = ?)
      AND NOT EXISTS (
        SELECT 1 FROM account_blocks AS blocks
        WHERE (blocks.blocker_account_id = requests.sender_account_id
          AND blocks.blocked_account_id = requests.recipient_account_id)
           OR (blocks.blocker_account_id = requests.recipient_account_id
          AND blocks.blocked_account_id = requests.sender_account_id)
      )
      ORDER BY requests.created_at DESC`)
    .bind(accountId, accountId)
    .all<FriendRequestRow>();
  const friends: SocialPerson[] = [];
  const incoming: FriendRequestSummary[] = [];
  const outgoing: FriendRequestSummary[] = [];
  for (const row of result.results ?? []) {
    const sentByMe = row.sender_account_id === accountId;
    const otherUsername = sentByMe ? row.recipient_username : row.sender_username;
    if (!otherUsername) continue;
    if (row.status === "accepted") {
      friends.push({ username: otherUsername });
    } else if (row.status === "pending") {
      const item = { id: row.id, username: otherUsername, createdAt: row.created_at };
      (sentByMe ? outgoing : incoming).push(item);
    }
  }
  friends.sort((left, right) => left.username.localeCompare(right.username));
  return { friends, incoming, outgoing };
}

export async function sendFriendRequest(
  sender: AccountProfile,
  targetUsername: string,
): Promise<SendFriendRequestResult> {
  if (!sender.username) {
    return {
      ok: false,
      code: "invalid_account",
      message: "Choose your username before adding friends.",
    };
  }
  const recipient = await findAccountByUsername(targetUsername);
  if (!recipient?.username) {
    return {
      ok: false,
      code: "not_found",
      message: "No player has that username.",
    };
  }
  if (recipient.id === sender.id) {
    return { ok: false, code: "self", message: "That is your own username." };
  }
  if (await accountsAreBlocked(sender.id, recipient.id)) {
    return {
      ok: false,
      code: "blocked",
      message: "You can’t connect with that player.",
    };
  }
  const existing = await friendRequestForPair(sender.id, recipient.id);
  if (existing?.status === "accepted") {
    return { ok: true, state: "already_friends", requestId: existing.id };
  }
  if (existing?.status === "pending") {
    if (existing.sender_account_id === sender.id) {
      return { ok: true, state: "sent", requestId: existing.id };
    }
    return {
      ok: false,
      code: "incoming_exists",
      message: `${recipient.username} already sent you a request. Accept it below.`,
    };
  }

  const now = new Date().toISOString();
  const id = existing?.id ?? crypto.randomUUID();
  const database = getDatabase();
  const queuedPush = queueFriendRequestNotifications(database, {
    friendRequestId: id,
    recipientAccountId: recipient.id,
    createdAt: now,
  });
  try {
    if (existing) {
      const [updated] = await database.batch([
        database.prepare(`UPDATE friend_requests
          SET sender_account_id = ?, recipient_account_id = ?, status = 'pending',
              created_at = ?, responded_at = NULL
          WHERE id = ? AND status = 'declined'`)
          .bind(sender.id, recipient.id, now, existing.id),
        queuedPush,
      ]);
      if ((updated.meta.changes ?? 0) !== 1) {
        const settled = settledFriendRequestSend(
          await friendRequestForPair(sender.id, recipient.id),
          sender.id,
          recipient.username,
        );
        if (settled) return settled;
        return {
          ok: false,
          code: "incoming_exists",
          message: `${recipient.username} already sent you a request. Accept it below.`,
        };
      }
    } else {
      await database.batch([
        database.prepare(`INSERT INTO friend_requests (
          id, pair_key, sender_account_id, recipient_account_id, status, created_at
        ) VALUES (?, ?, ?, ?, 'pending', ?)`)
          .bind(id, friendPairKey(sender.id, recipient.id), sender.id, recipient.id, now),
        queuedPush,
      ]);
    }
  } catch {
    const settled = settledFriendRequestSend(
      await friendRequestForPair(sender.id, recipient.id),
      sender.id,
      recipient.username,
    );
    if (settled) return settled;
    return {
      ok: false,
      code: "incoming_exists",
      message: `${recipient.username} already sent you a request. Accept it below.`,
    };
  }
  return { ok: true, state: "sent", requestId: id };
}

export async function respondToFriendRequest(
  accountId: string,
  requestId: string,
  accept: boolean,
): Promise<RespondFriendRequestResult> {
  await ensureSchema();
  const pending = await getDatabase()
    .prepare(`SELECT sender_account_id FROM friend_requests
      WHERE id = ? AND recipient_account_id = ? AND status = 'pending'`)
    .bind(requestId, accountId)
    .first<{ sender_account_id: string }>();
  if (pending && await accountsAreBlocked(accountId, pending.sender_account_id)) {
    return { ok: false, code: "settled", message: "That connection is unavailable." };
  }
  const nextStatus = accept ? "accepted" : "declined";
  const result = await getDatabase()
    .prepare(`UPDATE friend_requests SET status = ?, responded_at = ?
      WHERE id = ? AND recipient_account_id = ? AND status = 'pending'`)
    .bind(nextStatus, new Date().toISOString(), requestId, accountId)
    .run();
  if ((result.meta.changes ?? 0) === 1) return { ok: true, status: nextStatus };
  const existing = await getDatabase()
    .prepare("SELECT status FROM friend_requests WHERE id = ? AND recipient_account_id = ?")
    .bind(requestId, accountId)
    .first<{ status: string }>();
  return existing
    ? { ok: false, code: "settled", message: "That friend request was handled already." }
    : { ok: false, code: "not_found", message: "Friend request not found." };
}

export async function connectFriendAccounts(
  senderAccountId: string,
  recipientAccountId: string,
): Promise<void> {
  if (senderAccountId === recipientAccountId) {
    throw new Error("An account cannot connect to itself");
  }
  if (await accountsAreBlocked(senderAccountId, recipientAccountId)) return;
  await ensureSchema();
  const now = new Date().toISOString();
  await getDatabase()
    .prepare(`INSERT INTO friend_requests (
        id, pair_key, sender_account_id, recipient_account_id, status, created_at, responded_at
      ) VALUES (?, ?, ?, ?, 'accepted', ?, ?)
      ON CONFLICT(pair_key) DO UPDATE SET
        status = 'accepted',
        responded_at = excluded.responded_at`)
    .bind(
      crypto.randomUUID(),
      friendPairKey(senderAccountId, recipientAccountId),
      senderAccountId,
      recipientAccountId,
      now,
      now,
    )
    .run();
}

export async function areFriends(leftAccountId: string, rightAccountId: string): Promise<boolean> {
  if (await accountsAreBlocked(leftAccountId, rightAccountId)) return false;
  return (await friendRequestForPair(leftAccountId, rightAccountId))?.status === "accepted";
}

export async function friendAccountByUsername(
  accountId: string,
  username: string,
): Promise<AccountProfile | null> {
  const candidate = await findAccountByUsername(username);
  return candidate && await areFriends(accountId, candidate.id) ? candidate : null;
}

export async function cancelOutgoingFriendRequest(
  accountId: string,
  requestId: string,
): Promise<boolean> {
  await ensureSchema();
  const result = await getDatabase()
    .prepare(`UPDATE friend_requests SET status = 'declined', responded_at = ?
      WHERE id = ? AND sender_account_id = ? AND status = 'pending'`)
    .bind(new Date().toISOString(), requestId, accountId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function removeFriend(
  accountId: string,
  targetUsername: string,
): Promise<boolean> {
  const target = await findAccountByUsername(targetUsername);
  if (!target) return false;
  await ensureSchema();
  const result = await getDatabase()
    .prepare(`DELETE FROM friend_requests
      WHERE pair_key = ? AND status = 'accepted'
        AND (sender_account_id = ? OR recipient_account_id = ?)`)
    .bind(friendPairKey(accountId, target.id), accountId, accountId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export interface BlockedPlayer extends SocialPerson {
  blockedAt: string;
}

export async function listBlockedPlayers(accountId: string): Promise<BlockedPlayer[]> {
  await ensureSchema();
  const result = await getDatabase()
    .prepare(`SELECT accounts.username, blocks.created_at
      FROM account_blocks AS blocks
      JOIN accounts ON accounts.id = blocks.blocked_account_id
      WHERE blocks.blocker_account_id = ? AND accounts.username IS NOT NULL
      ORDER BY blocks.created_at DESC`)
    .bind(accountId)
    .all<{ username: string; created_at: string }>();
  return (result.results ?? []).map((row) => ({
    username: row.username,
    blockedAt: row.created_at,
  }));
}

export async function blockPlayer(
  accountId: string,
  targetUsername: string,
): Promise<{ ok: true; username: string } | { ok: false; message: string }> {
  const target = await findAccountByUsername(targetUsername);
  if (!target?.username) return { ok: false, message: "Player not found." };
  if (target.id === accountId) return { ok: false, message: "You cannot block yourself." };
  await ensureSchema();
  const now = new Date().toISOString();
  const database = getDatabase();
  await database.batch([
    database.prepare(`INSERT OR IGNORE INTO account_blocks (
        blocker_account_id, blocked_account_id, created_at
      ) VALUES (?, ?, ?)`)
      .bind(accountId, target.id, now),
    database.prepare("DELETE FROM friend_requests WHERE pair_key = ?")
      .bind(friendPairKey(accountId, target.id)),
    database.prepare(`UPDATE games
      SET status = 'completed', winner_color = NULL, termination = 'cancelled',
        finished_at = ?, updated_at = ?, version = version + 1
      WHERE status = 'waiting'
        AND EXISTS (
          SELECT 1 FROM game_memberships mine
          WHERE mine.game_id = games.id AND mine.account_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM game_memberships theirs
          WHERE theirs.game_id = games.id AND theirs.account_id = ?
        )`)
      .bind(now, now, accountId, target.id),
    database.prepare(`DELETE FROM account_notifications
      WHERE (recipient_account_id = ? AND actor_account_id = ?)
         OR (recipient_account_id = ? AND actor_account_id = ?)`)
      .bind(accountId, target.id, target.id, accountId),
  ]);
  return { ok: true, username: target.username };
}

export async function unblockPlayer(
  accountId: string,
  targetUsername: string,
): Promise<boolean> {
  const target = await findAccountByUsername(targetUsername);
  if (!target) return false;
  await ensureSchema();
  const result = await getDatabase()
    .prepare(`DELETE FROM account_blocks
      WHERE blocker_account_id = ? AND blocked_account_id = ?`)
    .bind(accountId, target.id)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function accountFeatureEnabled(
  accountId: string,
  featureKey: string,
): Promise<boolean> {
  await ensureSchema();
  const row = await getDatabase()
    .prepare(`SELECT enabled FROM account_feature_flags
      WHERE account_id = ? AND feature_key = ?`)
    .bind(accountId, featureKey)
    .first<{ enabled: number }>();
  return row?.enabled === 1;
}

export async function setFeatureByUsername(
  username: string,
  featureKey: string,
  enabled: boolean,
): Promise<{ ok: true; username: string; enabled: boolean } | { ok: false; message: string }> {
  const account = await findAccountByUsername(username);
  if (!account?.username) return { ok: false, message: "Player not found." };
  await ensureSchema();
  const now = new Date().toISOString();
  const database = getDatabase();
  const statements = [database
    .prepare(`INSERT INTO account_feature_flags (account_id, feature_key, enabled, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id, feature_key) DO UPDATE SET
        enabled = excluded.enabled,
        updated_at = excluded.updated_at`)
    .bind(account.id, featureKey, enabled ? 1 : 0, now)];
  if (enabled) {
    statements.push(database
      .prepare("DELETE FROM feature_access_requests WHERE account_id = ? AND feature_key = ?")
      .bind(account.id, featureKey));
  }
  await database.batch(statements);
  return { ok: true, username: account.username, enabled };
}

export async function listFeatureUsernames(featureKey: string): Promise<string[]> {
  await ensureSchema();
  const result = await getDatabase()
    .prepare(`SELECT accounts.username
      FROM account_feature_flags
      JOIN accounts ON accounts.id = account_feature_flags.account_id
      WHERE account_feature_flags.feature_key = ?
        AND account_feature_flags.enabled = 1
        AND accounts.username IS NOT NULL
      ORDER BY accounts.username_canonical`)
    .bind(featureKey)
    .all<{ username: string }>();
  return (result.results ?? []).map((row) => row.username);
}

export async function accountUsername(accountId: string): Promise<string | null> {
  return (await getAccountProfile(accountId))?.username ?? null;
}
