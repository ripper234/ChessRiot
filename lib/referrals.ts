import { ensureSchema, getDatabase } from "@/db";
import type { AccountProfile } from "./accounts";
import type { PlayerAccount } from "./account-auth";
import { REFERRAL_CODE_LENGTH, REFERRAL_CREDITS } from "./referral-constants";
import { creditBalance, STARTER_CREDITS } from "./credits";
import { connectFriendAccounts } from "./social";

export { REFERRAL_CREDITS };

const REFERRAL_CODE_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${REFERRAL_CODE_LENGTH}}$`);

interface ReferralLinkRow {
  account_id: string;
  code: string;
  username: string;
}

interface ReferralAttributionRow {
  referred_account_id: string;
  referrer_account_id: string;
  referral_code: string;
  status: "pending" | "rewarded";
  credits: number;
}

export interface ReferralPreview {
  accountId: string;
  code: string;
  username: string;
}

export interface ReferralSummary {
  code: string;
  credits: number;
  invitedPlayers: number;
  creditsPerSignup: number;
}

export type ClaimReferralResult =
  | {
      ok: true;
      state: "awaiting_username" | "connected" | "rewarded";
      inviterUsername: string;
      creditsAwarded: number;
      creditBalance: number;
    }
  | {
      ok: false;
      code: "not_found" | "self" | "already_attributed";
      message: string;
    };

export function isReferralCode(value: unknown): value is string {
  return typeof value === "string" && REFERRAL_CODE_PATTERN.test(value);
}

function randomReferralCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function referralAttributionFor(
  referredAccountId: string,
): Promise<ReferralAttributionRow | null> {
  return (await getDatabase()
    .prepare(`SELECT referred_account_id, referrer_account_id, referral_code, status, credits
      FROM referral_attributions WHERE referred_account_id = ?`)
    .bind(referredAccountId)
    .first<ReferralAttributionRow>()) ?? null;
}

async function referralBalance(accountId: string): Promise<{
  credits: number;
  invitedPlayers: number;
}> {
  const row = await getDatabase()
    .prepare(`SELECT COUNT(*) AS invited_players
      FROM referral_attributions
      WHERE referrer_account_id = ? AND status = 'rewarded'`)
    .bind(accountId)
    .first<{ invited_players: number }>();
  return {
    credits: await creditBalance(accountId),
    invitedPlayers: Number(row?.invited_players ?? 0),
  };
}

export async function ensureReferralCode(accountId: string): Promise<string> {
  await ensureSchema();
  const database = getDatabase();
  const existing = await database
    .prepare("SELECT code FROM referral_links WHERE account_id = ?")
    .bind(accountId)
    .first<{ code: string }>();
  if (existing?.code) return existing.code;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = randomReferralCode();
    await database
      .prepare(`INSERT OR IGNORE INTO referral_links (account_id, code, created_at)
        VALUES (?, ?, ?) `)
      .bind(accountId, code, new Date().toISOString())
      .run();
    const settled = await database
      .prepare("SELECT code FROM referral_links WHERE account_id = ?")
      .bind(accountId)
      .first<{ code: string }>();
    if (settled?.code) return settled.code;
  }
  throw new Error("Could not create a referral link");
}

export async function upsertGoogleCallbackAccount(
  account: PlayerAccount,
  referralCode: string | null,
): Promise<{ created: boolean; referralReserved: boolean; deleted: boolean }> {
  await ensureSchema();
  const database = getDatabase();
  const now = new Date().toISOString();
  const statements = [
    database
      .prepare(`INSERT OR IGNORE INTO accounts (
        id, display_name, tutorial_status, created_at, last_seen_at, last_captcha_at
      ) SELECT ?, ?, 'pending', ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM account_tombstones WHERE account_id = ?
      )`)
      .bind(account.id, account.displayName, now, now, now, account.id),
  ];
  if (referralCode && isReferralCode(referralCode)) {
    statements.push(
      database
        .prepare(`INSERT OR IGNORE INTO referral_attributions (
          referred_account_id, referrer_account_id, referral_code, status, credits, created_at
        )
        SELECT ?, links.account_id, links.code, 'pending', 0, ?
        FROM referral_links AS links
        WHERE links.code = ?
          AND links.account_id <> ?
          AND changes() = 1`)
        .bind(account.id, now, referralCode, account.id),
    );
  }
  statements.push(
    database.prepare(`INSERT OR IGNORE INTO account_credit_ledger (
      id, account_id, amount, reason, source_key, created_at
    ) SELECT ?, ?, ?, 'starter', ?, ?
      WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ?)`)
      .bind(
        `starter:${account.id}`,
        account.id,
        STARTER_CREDITS,
        `starter:${account.id}`,
        now,
        account.id,
      ),
  );
  statements.push(
    database
      .prepare("UPDATE accounts SET display_name = ?, last_seen_at = ? WHERE id = ?")
      .bind(account.displayName, now, account.id),
  );
  const results = await database.batch(statements);
  const state = await database.prepare(`SELECT
      EXISTS(SELECT 1 FROM accounts WHERE id = ?) AS active,
      EXISTS(SELECT 1 FROM account_tombstones WHERE account_id = ?) AS deleted`)
    .bind(account.id, account.id)
    .first<{ active: number; deleted: number }>();
  if (state?.deleted === 1 || state?.active !== 1) {
    return { created: false, referralReserved: false, deleted: true };
  }
  return {
    created: (results[0]?.meta.changes ?? 0) === 1,
    referralReserved: referralCode && isReferralCode(referralCode)
      ? (results[1]?.meta.changes ?? 0) === 1
      : false,
    deleted: false,
  };
}

export async function getReferralPreview(code: string): Promise<ReferralPreview | null> {
  if (!isReferralCode(code)) return null;
  await ensureSchema();
  const row = await getDatabase()
    .prepare(`SELECT links.account_id, links.code, accounts.username
      FROM referral_links AS links
      JOIN accounts ON accounts.id = links.account_id
      WHERE links.code = ? AND accounts.username IS NOT NULL`)
    .bind(code)
    .first<ReferralLinkRow>();
  return row ? {
    accountId: row.account_id,
    code: row.code,
    username: row.username,
  } : null;
}

export async function getReferralSummary(accountId: string): Promise<ReferralSummary> {
  const code = await ensureReferralCode(accountId);
  const balance = await referralBalance(accountId);
  return {
    code,
    credits: balance.credits,
    invitedPlayers: balance.invitedPlayers,
    creditsPerSignup: REFERRAL_CREDITS,
  };
}

export async function completePendingReferral(
  referredAccountId: string,
): Promise<ClaimReferralResult | null> {
  await ensureSchema();
  const attribution = await referralAttributionFor(referredAccountId);
  if (!attribution) return null;

  const preview = await getReferralPreview(attribution.referral_code);
  if (!preview) return null;

  let creditsAwarded = 0;
  if (attribution.status === "pending") {
    const account = await getDatabase()
      .prepare("SELECT username FROM accounts WHERE id = ?")
      .bind(referredAccountId)
      .first<{ username: string | null }>();
    if (!account?.username) return null;
    const database = getDatabase();
    const now = new Date().toISOString();
    const pairKey = [preview.accountId, referredAccountId].sort().join(":");
    const results = await database.batch([
      database
        .prepare(`UPDATE referral_attributions
          SET status = 'rewarded', credits = ?, completed_at = ?
          WHERE referred_account_id = ? AND status = 'pending'`)
        .bind(REFERRAL_CREDITS, now, referredAccountId),
      database
        .prepare(`INSERT INTO friend_requests (
          id, pair_key, sender_account_id, recipient_account_id, status, created_at, responded_at
        ) SELECT ?, ?, ?, ?, 'accepted', ?, ?
        WHERE changes() = 1
        ON CONFLICT(pair_key) DO UPDATE SET
          status = 'accepted',
          responded_at = excluded.responded_at`)
        .bind(
          crypto.randomUUID(),
          pairKey,
          preview.accountId,
          referredAccountId,
          now,
          now,
        ),
      database
        .prepare(`INSERT OR IGNORE INTO account_credit_ledger (
          id, account_id, amount, reason, source_key, created_at
        ) SELECT ?, ?, ?, 'referral', ?, ?
        WHERE EXISTS (
          SELECT 1 FROM referral_attributions
          WHERE referred_account_id = ?
            AND referrer_account_id = ?
            AND status = 'rewarded'
        )`)
        .bind(
          `referral:${referredAccountId}`,
          preview.accountId,
          REFERRAL_CREDITS,
          `referral:${referredAccountId}`,
          now,
          referredAccountId,
          preview.accountId,
        ),
    ]);
    creditsAwarded = (results[0]?.meta.changes ?? 0) === 1 ? REFERRAL_CREDITS : 0;
  }

  await connectFriendAccounts(preview.accountId, referredAccountId);
  const balance = await referralBalance(preview.accountId);
  return {
    ok: true,
    state: "rewarded",
    inviterUsername: preview.username,
    creditsAwarded,
    creditBalance: balance.credits,
  };
}

export async function claimReferral(
  account: AccountProfile,
  code: string,
): Promise<ClaimReferralResult> {
  const preview = await getReferralPreview(code);
  if (!preview) {
    return { ok: false, code: "not_found", message: "This invite link is not available." };
  }
  if (preview.accountId === account.id) {
    return { ok: false, code: "self", message: "This is your own invite link." };
  }

  await ensureSchema();
  const existing = await referralAttributionFor(account.id);
  if (!account.username) {
    if (existing && existing.referrer_account_id !== preview.accountId) {
      return {
        ok: false,
        code: "already_attributed",
        message: "Your first invite is already saved. Finish choosing your username.",
      };
    }
    const balance = await referralBalance(preview.accountId);
    return {
      ok: true,
      state: "awaiting_username",
      inviterUsername: preview.username,
      creditsAwarded: 0,
      creditBalance: balance.credits,
    };
  }

  if (existing?.status === "pending") {
    if (existing.referrer_account_id !== preview.accountId) {
      return {
        ok: false,
        code: "already_attributed",
        message: "Your first invite is already saved.",
      };
    }
    const completed = await completePendingReferral(account.id);
    if (completed) return completed;
  }

  await connectFriendAccounts(preview.accountId, account.id);
  const settled = await referralAttributionFor(account.id);
  const balance = await referralBalance(preview.accountId);
  const rewardedByThisInvite = settled?.status === "rewarded"
    && settled.referrer_account_id === preview.accountId;
  return {
    ok: true,
    state: rewardedByThisInvite ? "rewarded" : "connected",
    inviterUsername: preview.username,
    creditsAwarded: 0,
    creditBalance: balance.credits,
  };
}
