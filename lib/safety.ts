import { ensureSchema, getDatabase } from "@/db";
import { findAccountByUsername } from "./accounts";

export const SAFETY_REPORT_CATEGORIES = [
  "spam",
  "harassment",
  "inappropriate_username",
  "cheating",
  "other",
] as const;

export type SafetyReportCategory = typeof SAFETY_REPORT_CATEGORIES[number];
export type SafetyReportStatus = "new" | "reviewed" | "closed";

export interface AdminSafetyReport {
  id: string;
  reporterUsername: string;
  targetUsername: string;
  category: SafetyReportCategory;
  note: string | null;
  status: SafetyReportStatus;
  createdAt: string;
  archived: boolean;
}

export function isSafetyReportCategory(value: unknown): value is SafetyReportCategory {
  return typeof value === "string"
    && (SAFETY_REPORT_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeSafetyNote(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const note = value.normalize("NFC").trim();
  if (!note) return null;
  return Array.from(note).length <= 280 ? note : undefined;
}

async function hasPlayerConnection(
  reporterAccountId: string,
  targetAccountId: string,
): Promise<boolean> {
  const row = await getDatabase()
    .prepare(`SELECT 1 AS connected
      WHERE EXISTS (
        SELECT 1 FROM friend_requests
        WHERE pair_key = ? AND status IN ('pending', 'accepted')
      ) OR EXISTS (
        SELECT 1 FROM game_memberships mine
        JOIN game_memberships theirs ON theirs.game_id = mine.game_id
        WHERE mine.account_id = ? AND theirs.account_id = ?
      )`)
    .bind(
      [reporterAccountId, targetAccountId].sort().join(":"),
      reporterAccountId,
      targetAccountId,
    )
    .first<{ connected: number }>();
  return Boolean(row);
}

export async function reportPlayer(input: {
  reporterAccountId: string;
  targetUsername: string;
  category: SafetyReportCategory;
  note: string | null;
}): Promise<{ ok: true; reportId: string } | { ok: false; message: string }> {
  const target = await findAccountByUsername(input.targetUsername);
  if (!target?.username || target.id === input.reporterAccountId) {
    return { ok: false, message: "That player cannot be reported here." };
  }
  await ensureSchema();
  if (!(await hasPlayerConnection(input.reporterAccountId, target.id))) {
    return { ok: false, message: "You can report players you have connected or played with." };
  }
  const duplicate = await getDatabase()
    .prepare(`SELECT id FROM safety_reports
      WHERE reporter_account_id = ? AND target_account_id = ? AND category = ?
        AND created_at >= ?
      ORDER BY created_at DESC LIMIT 1`)
    .bind(
      input.reporterAccountId,
      target.id,
      input.category,
      new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    )
    .first<{ id: string }>();
  if (duplicate?.id) return { ok: true, reportId: duplicate.id };
  const reportId = crypto.randomUUID();
  await getDatabase()
    .prepare(`INSERT INTO safety_reports (
      id, reporter_account_id, target_account_id, category, note, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'new', ?)`)
    .bind(
      reportId,
      input.reporterAccountId,
      target.id,
      input.category,
      input.note,
      new Date().toISOString(),
    )
    .run();
  return { ok: true, reportId };
}

export async function listSafetyReports(): Promise<AdminSafetyReport[]> {
  await ensureSchema();
  const database = getDatabase();
  const now = new Date().toISOString();
  await database.prepare("DELETE FROM safety_report_archive WHERE expires_at < ?")
    .bind(now)
    .run();
  const rows = await database.prepare(`SELECT * FROM (
      SELECT reports.id, reporter.username AS reporter_username,
        target.username AS target_username, reports.category, reports.note,
        reports.status, reports.created_at, 0 AS archived
      FROM safety_reports AS reports
      JOIN accounts AS reporter ON reporter.id = reports.reporter_account_id
      JOIN accounts AS target ON target.id = reports.target_account_id
      UNION ALL
      SELECT id, reporter_username, target_username, category, note, status,
        created_at, 1 AS archived
      FROM safety_report_archive WHERE expires_at >= ?
    ) ORDER BY created_at DESC, id DESC LIMIT 100`)
    .bind(now)
    .all<{
      id: string;
      reporter_username: string;
      target_username: string;
      category: SafetyReportCategory;
      note: string | null;
      status: SafetyReportStatus;
      created_at: string;
      archived: number;
    }>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    reporterUsername: row.reporter_username,
    targetUsername: row.target_username,
    category: row.category,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    archived: row.archived === 1,
  }));
}

export async function updateSafetyReportStatus(
  id: string,
  status: Exclude<SafetyReportStatus, "new">,
): Promise<boolean> {
  await ensureSchema();
  const database = getDatabase();
  const [live, archived] = await database.batch([
    database.prepare("UPDATE safety_reports SET status = ? WHERE id = ?")
      .bind(status, id),
    database.prepare("UPDATE safety_report_archive SET status = ? WHERE id = ?")
      .bind(status, id),
  ]);
  return (live.meta.changes ?? 0) + (archived.meta.changes ?? 0) > 0;
}
