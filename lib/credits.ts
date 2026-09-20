import { ensureSchema, getDatabase } from "@/db";

export const STARTER_CREDITS = 10;
export const MAGIC_GAME_CREDIT_COST = 1;
export const WORLD_ROYALTY_GAMES_PER_CREDIT = 5;

export async function ensureStarterCredits(accountId: string): Promise<void> {
  await ensureSchema();
  const now = new Date().toISOString();
  await getDatabase()
    .prepare(`INSERT OR IGNORE INTO account_credit_ledger (
      id, account_id, amount, reason, source_key, created_at
    ) SELECT ?, ?, ?, 'starter', ?, ?
      WHERE EXISTS (SELECT 1 FROM accounts WHERE id = ?)`) 
    .bind(
      `starter:${accountId}`,
      accountId,
      STARTER_CREDITS,
      `starter:${accountId}`,
      now,
      accountId,
    )
    .run();
}

export async function creditBalance(accountId: string): Promise<number> {
  await ensureStarterCredits(accountId);
  const row = await getDatabase()
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS balance
      FROM account_credit_ledger WHERE account_id = ?`)
    .bind(accountId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}
