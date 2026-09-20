import { ensureSchema, getDatabase } from "@/db";
import { getAccountProfile } from "./accounts";
import { listBlockedPlayers, listSocialSummary } from "./social";
import { canonicalUsername, normalizedUsername } from "./usernames";

const GAME_EXPORT_PAGE_SIZE = 500;
const MOVE_EXPORT_PAGE_SIZE = 5_000;
const ACCOUNT_EXPORT_PAGE_SIZE = 1_000;

type ExportRow = Record<string, string | number | null>;

interface CursorExportRow extends ExportRow {
  export_cursor_time: string;
  export_cursor_id: string;
}

async function listAllCursorRows<T extends CursorExportRow>(
  loadPage: (timeCursor: string, idCursor: string) => Promise<D1Result<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  let timeCursor = "";
  let idCursor = "";
  while (true) {
    const page = await loadPage(timeCursor, idCursor);
    const next = page.results ?? [];
    rows.push(...next);
    if (next.length < ACCOUNT_EXPORT_PAGE_SIZE) return rows;
    const last = next.at(-1);
    timeCursor = last?.export_cursor_time ?? "";
    idCursor = last?.export_cursor_id ?? "";
  }
}

async function listAllCreatorWorldPerformance(accountId: string): Promise<Array<{
  world_code: string;
  paid_games: number;
  games_with_human_play: number;
  qualifying_games: number;
  royalty_credits_earned: number;
}>> {
  const database = getDatabase();
  const rows: Array<{
    world_code: string;
    paid_games: number;
    games_with_human_play: number;
    qualifying_games: number;
    royalty_credits_earned: number;
  }> = [];
  let codeCursor = "";
  while (true) {
    const page = await database.prepare(`SELECT uses.world_code,
        COUNT(*) AS paid_games,
        SUM(CASE WHEN uses.human_played_at IS NOT NULL THEN 1 ELSE 0 END)
          AS games_with_human_play,
        SUM(uses.qualifies_for_royalty) AS qualifying_games,
        COALESCE((SELECT SUM(ledger.amount) FROM account_credit_ledger AS ledger
          WHERE ledger.account_id = ?
            AND ledger.reason = 'world_royalty'
            AND ledger.world_code = uses.world_code), 0) AS royalty_credits_earned
      FROM magic_world_uses AS uses
      WHERE uses.creator_account_id = ? AND uses.world_code > ?
      GROUP BY uses.world_code
      ORDER BY uses.world_code
      LIMIT ${ACCOUNT_EXPORT_PAGE_SIZE}`)
      .bind(accountId, accountId, codeCursor)
      .all<{
        world_code: string;
        paid_games: number;
        games_with_human_play: number;
        qualifying_games: number;
        royalty_credits_earned: number;
      }>();
    const next = page.results ?? [];
    rows.push(...next);
    if (next.length < ACCOUNT_EXPORT_PAGE_SIZE) return rows;
    codeCursor = next.at(-1)?.world_code ?? "";
  }
}

async function listAllAccountGames(accountId: string): Promise<ExportRow[]> {
  const database = getDatabase();
  const games: ExportRow[] = [];
  let createdAtCursor = "";
  let idCursor = "";
  while (true) {
    const page = await database.prepare(`SELECT games.id, games.status, games.turn_color,
        games.winner_color, games.termination, games.created_at, games.joined_at,
        games.updated_at, games.finished_at, memberships.color,
        COALESCE(settings.game_mode, 'multiplayer') AS game_mode,
        COALESCE(settings.variant_id, 'standard') AS variant_id,
        settings.ai_difficulty, settings.turn_pace_days, settings.world_code,
        recap.id AS recap_share_id,
        CASE WHEN memberships.color = 'w' THEN games.black_name ELSE games.white_name END AS opponent
      FROM game_memberships AS memberships
      JOIN games ON games.id = memberships.game_id
      LEFT JOIN game_settings AS settings ON settings.game_id = games.id
      LEFT JOIN game_recap_shares AS recap ON recap.game_id = games.id
      WHERE memberships.account_id = ?
        AND (games.created_at > ? OR (games.created_at = ? AND games.id > ?))
      ORDER BY games.created_at, games.id
      LIMIT ${GAME_EXPORT_PAGE_SIZE}`)
      .bind(accountId, createdAtCursor, createdAtCursor, idCursor)
      .all<ExportRow>();
    const rows = page.results ?? [];
    games.push(...rows);
    if (rows.length < GAME_EXPORT_PAGE_SIZE) return games;
    const last = rows.at(-1);
    createdAtCursor = String(last?.created_at ?? "");
    idCursor = String(last?.id ?? "");
  }
}

async function listAllAccountMoves(accountId: string): Promise<ExportRow[]> {
  const database = getDatabase();
  const moves: ExportRow[] = [];
  let gameIdCursor = "";
  let plyCursor = -1;
  while (true) {
    const page = await database.prepare(`SELECT moves.game_id, moves.ply, moves.color,
        moves.from_square, moves.to_square, moves.promotion, moves.san,
        moves.second_from_square, moves.second_to_square, moves.second_san,
        moves.created_at
      FROM moves
      JOIN game_memberships ON game_memberships.game_id = moves.game_id
      WHERE game_memberships.account_id = ?
        AND (moves.game_id > ? OR (moves.game_id = ? AND moves.ply > ?))
      ORDER BY moves.game_id, moves.ply
      LIMIT ${MOVE_EXPORT_PAGE_SIZE}`)
      .bind(accountId, gameIdCursor, gameIdCursor, plyCursor)
      .all<ExportRow>();
    const rows = page.results ?? [];
    moves.push(...rows);
    if (rows.length < MOVE_EXPORT_PAGE_SIZE) return moves;
    const last = rows.at(-1);
    gameIdCursor = String(last?.game_id ?? "");
    plyCursor = Number(last?.ply ?? -1);
  }
}

export async function exportAccountData(accountId: string): Promise<Record<string, unknown>> {
  await ensureSchema();
  const database = getDatabase();
  const [
    profile,
    social,
    blocked,
    accountRow,
    games,
    moves,
    reports,
    referrals,
    enabledFeatures,
    pendingFeatures,
    creditLedger,
    worlds,
    worldSources,
    worldEntitlements,
    paidWorldUses,
    creatorWorldPerformance,
  ] = await Promise.all([
    getAccountProfile(accountId),
    listSocialSummary(accountId),
    listBlockedPlayers(accountId),
    database.prepare(`SELECT created_at, last_seen_at FROM accounts WHERE id = ?`)
      .bind(accountId)
      .first<{ created_at: string; last_seen_at: string }>(),
    listAllAccountGames(accountId),
    listAllAccountMoves(accountId),
    database.prepare(`SELECT target.username AS username, reports.category,
        reports.note, reports.status, reports.created_at
      FROM safety_reports AS reports
      JOIN accounts AS target ON target.id = reports.target_account_id
      WHERE reports.reporter_account_id = ?
      ORDER BY reports.created_at`)
      .bind(accountId)
      .all<Record<string, string | null>>(),
    database.prepare(`SELECT COUNT(*) AS invited_players,
        COALESCE(SUM(credits), 0) AS credits
      FROM referral_attributions
      WHERE referrer_account_id = ? AND status = 'rewarded'`)
      .bind(accountId)
      .first<{ invited_players: number; credits: number }>(),
    database.prepare(`SELECT feature_key FROM account_feature_flags
      WHERE account_id = ? AND enabled = 1 ORDER BY feature_key`)
      .bind(accountId)
      .all<{ feature_key: string }>(),
    database.prepare(`SELECT feature_key, requested_at FROM feature_access_requests
      WHERE account_id = ? ORDER BY requested_at`)
      .bind(accountId)
      .all<{ feature_key: string; requested_at: string }>(),
    listAllCursorRows((timeCursor, idCursor) => database.prepare(`SELECT
        ledger.id AS export_cursor_id, ledger.created_at AS export_cursor_time,
        ledger.amount, ledger.reason, ledger.world_code,
        CASE WHEN ledger.game_id IS NULL OR EXISTS (
          SELECT 1 FROM game_memberships AS membership
          WHERE membership.account_id = ? AND membership.game_id = ledger.game_id
        ) THEN ledger.game_id ELSE NULL END AS game_id,
        CASE WHEN ledger.game_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM game_memberships AS membership
          WHERE membership.account_id = ? AND membership.game_id = ledger.game_id
        ) THEN 1 ELSE 0 END AS private_external_game,
        ledger.created_at
      FROM account_credit_ledger AS ledger
      WHERE ledger.account_id = ?
        AND (ledger.created_at > ? OR (ledger.created_at = ? AND ledger.id > ?))
      ORDER BY ledger.created_at, ledger.id
      LIMIT ${ACCOUNT_EXPORT_PAGE_SIZE}`)
      .bind(accountId, accountId, accountId, timeCursor, timeCursor, idCursor)
      .all<CursorExportRow & {
        amount: number;
        reason: string;
        world_code: string | null;
        game_id: string | null;
        private_external_game: number;
        created_at: string;
      }>()),
    listAllCursorRows((timeCursor, idCursor) => database.prepare(`SELECT
        code AS export_cursor_id, created_at AS export_cursor_time,
        code, created_at FROM magic_worlds
      WHERE creator_account_id = ?
        AND (created_at > ? OR (created_at = ? AND code > ?))
      ORDER BY created_at, code
      LIMIT ${ACCOUNT_EXPORT_PAGE_SIZE}`)
      .bind(accountId, timeCursor, timeCursor, idCursor)
      .all<CursorExportRow & { code: string; created_at: string }>()),
    listAllCursorRows((timeCursor, idCursor) => database.prepare(`SELECT
        source_key AS export_cursor_id, created_at AS export_cursor_time,
        world_code, parent_code, kind, created_at
      FROM magic_world_sources
      WHERE contributor_account_id = ?
        AND (created_at > ? OR (created_at = ? AND source_key > ?))
      ORDER BY created_at, source_key
      LIMIT ${ACCOUNT_EXPORT_PAGE_SIZE}`)
      .bind(accountId, timeCursor, timeCursor, idCursor)
      .all<CursorExportRow & {
        world_code: string;
        parent_code: string | null;
        kind: string;
        created_at: string;
      }>()),
    listAllCursorRows((timeCursor, idCursor) => database.prepare(`SELECT
        game_create_request_id AS export_cursor_id,
        created_at AS export_cursor_time,
        world_code, created_at, consumed_at, game_id
      FROM magic_world_entitlements
      WHERE account_id = ?
        AND (created_at > ? OR (created_at = ? AND game_create_request_id > ?))
      ORDER BY created_at, game_create_request_id
      LIMIT ${ACCOUNT_EXPORT_PAGE_SIZE}`)
      .bind(accountId, timeCursor, timeCursor, idCursor)
      .all<CursorExportRow & {
        world_code: string;
        created_at: string;
        consumed_at: string | null;
        game_id: string | null;
      }>()),
    listAllCursorRows((timeCursor, idCursor) => database.prepare(`SELECT
        game_id AS export_cursor_id, created_at AS export_cursor_time,
        game_id, world_code, qualifies_for_royalty, human_played_at, created_at
      FROM magic_world_uses
      WHERE spender_account_id = ?
        AND (created_at > ? OR (created_at = ? AND game_id > ?))
      ORDER BY created_at, game_id
      LIMIT ${ACCOUNT_EXPORT_PAGE_SIZE}`)
      .bind(accountId, timeCursor, timeCursor, idCursor)
      .all<CursorExportRow & {
        game_id: string;
        world_code: string;
        qualifies_for_royalty: number;
        human_played_at: string | null;
        created_at: string;
      }>()),
    listAllCreatorWorldPerformance(accountId),
  ]);
  if (!profile?.username || !accountRow) throw new Error("account_not_found");

  const visibleCreditLedger = creditLedger.filter((entry) => !entry.private_external_game);
  const privateGameCreditSummary = Array.from(
    creditLedger
      .filter((entry) => Boolean(entry.private_external_game))
      .reduce((summaries, entry) => {
        const key = `${entry.reason}\n${entry.world_code ?? ""}`;
        const current = summaries.get(key) ?? {
          reason: entry.reason,
          worldCode: entry.world_code,
          amount: 0,
          entryCount: 0,
        };
        current.amount += Number(entry.amount);
        current.entryCount += 1;
        summaries.set(key, current);
        return summaries;
      }, new Map<string, {
        reason: string;
        worldCode: string | null;
        amount: number;
        entryCount: number;
      }>())
      .values(),
  ).sort((left, right) => (
    left.reason.localeCompare(right.reason)
    || (left.worldCode ?? "").localeCompare(right.worldCode ?? "")
  ));

  const movesByGame = new Map<string, Array<Record<string, unknown>>>();
  for (const row of moves) {
    const gameId = String(row.game_id);
    const list = movesByGame.get(gameId) ?? [];
    list.push({
      ply: row.ply,
      color: row.color,
      from: row.from_square,
      to: row.to_square,
      promotion: row.promotion,
      san: row.san,
      secondMove: row.second_from_square ? {
        from: row.second_from_square,
        to: row.second_to_square,
        san: row.second_san,
      } : null,
      playedAt: row.created_at,
    });
    movesByGame.set(gameId, list);
  }

  return {
    exportedAt: new Date().toISOString(),
    account: {
      displayName: profile.displayName,
      username: profile.username,
      createdAt: accountRow.created_at,
      lastSeenAt: accountRow.last_seen_at,
      tutorialStatus: profile.tutorialStatus,
    },
    social: {
      friends: social.friends.map((person) => person.username),
      incomingRequests: social.incoming.map((person) => ({
        username: person.username,
        createdAt: person.createdAt,
      })),
      outgoingRequests: social.outgoing.map((person) => ({
        username: person.username,
        createdAt: person.createdAt,
      })),
      blockedPlayers: blocked,
    },
    referrals: {
      referralCreditsEarned: Number(referrals?.credits ?? 0),
      invitedPlayers: Number(referrals?.invited_players ?? 0),
    },
    credits: {
      balance: creditLedger.reduce((sum, entry) => sum + Number(entry.amount), 0),
      ledger: visibleCreditLedger.map((entry) => ({
        amount: entry.amount,
        reason: entry.reason,
        worldCode: entry.world_code,
        gameId: entry.game_id,
        createdAt: entry.created_at,
      })),
      privateGameSummary: privateGameCreditSummary,
    },
    worldsCreated: worlds.map((world) => ({
      code: world.code,
      createdAt: world.created_at,
    })),
    worldSourceContributions: worldSources.map((source) => ({
      worldCode: source.world_code,
      parentCode: source.parent_code,
      kind: source.kind,
      createdAt: source.created_at,
    })),
    worldEntitlements: worldEntitlements.map((entitlement) => ({
      worldCode: entitlement.world_code,
      state: entitlement.consumed_at ? "consumed" : "reserved",
      createdAt: entitlement.created_at,
      consumedAt: entitlement.consumed_at,
      gameId: entitlement.game_id,
    })),
    worldUsesPaidByYou: paidWorldUses.map((use) => ({
      worldCode: use.world_code,
      gameId: use.game_id,
      qualifiedForRoyalty: Boolean(use.qualifies_for_royalty),
      humanPlayedAt: use.human_played_at,
      createdAt: use.created_at,
    })),
    worldCreatorPerformance: creatorWorldPerformance.map((performance) => ({
      worldCode: performance.world_code,
      paidGames: Number(performance.paid_games),
      gamesWithHumanPlay: Number(performance.games_with_human_play),
      qualifyingGames: Number(performance.qualifying_games),
      royaltyCreditsEarned: Number(performance.royalty_credits_earned),
    })),
    featureAccess: {
      enabled: (enabledFeatures.results ?? []).map((row) => row.feature_key),
      pendingRequests: (pendingFeatures.results ?? []).map((row) => ({
        feature: row.feature_key,
        requestedAt: row.requested_at,
      })),
    },
    exportCompleteness: {
      complete: true,
      gameCount: games.length,
      moveCount: moves.length,
      creditLedgerCount: creditLedger.length,
      worldSourceContributionCount: worldSources.length,
      worldEntitlementCount: worldEntitlements.length,
      worldPaidUseCount: paidWorldUses.length,
      worldCreatorPerformanceCount: creatorWorldPerformance.length,
    },
    games: games.map((game) => ({
      id: game.id,
      mode: game.game_mode,
      variant: game.variant_id,
      status: game.status,
      yourColor: game.color,
      opponent: game.opponent,
      turn: game.turn_color,
      botLevel: game.ai_difficulty,
      turnPaceDays: game.turn_pace_days,
      worldCode: game.world_code,
      winner: game.winner_color,
      result: game.termination,
      createdAt: game.created_at,
      joinedAt: game.joined_at,
      updatedAt: game.updated_at,
      finishedAt: game.finished_at,
      publicRecapPath: game.recap_share_id
        ? `/recap/${String(game.recap_share_id)}`
        : null,
      moves: movesByGame.get(String(game.id)) ?? [],
    })),
    safetyReports: reports.results ?? [],
    exclusions: [
      "OAuth and session data",
      "private invitation and seat credentials",
      "push endpoints and encryption keys",
      "internal account identifiers",
      "operational security hashes",
    ],
  };
}

export async function deleteAccountData(
  accountId: string,
  confirmedUsername: string,
): Promise<boolean> {
  await ensureSchema();
  const profile = await getAccountProfile(accountId);
  if (
    !profile?.username
    || normalizedUsername(profile.username) !== normalizedUsername(confirmedUsername)
  ) {
    return false;
  }
  const database = getDatabase();
  const now = new Date().toISOString();
  const revokedWhiteToken = `deleted_${crypto.randomUUID()}`;
  const revokedBlackToken = `deleted_${crypto.randomUUID()}`;
  const safetyArchiveExpiry = new Date(Date.now() + 90 * 24 * 60 * 60_000).toISOString();
  await database.batch([
    database.prepare(`INSERT INTO account_tombstones (
      account_id, username_canonical, deleted_at
    ) VALUES (?, ?, ?)`)
      .bind(accountId, canonicalUsername(profile.username), now),
    database.prepare(`INSERT OR REPLACE INTO safety_report_archive (
      id, reporter_username, target_username, category, note, status,
      created_at, archived_at, expires_at
    ) SELECT reports.id, reporter.username, target.username, reports.category,
      reports.note, reports.status, reports.created_at, ?, ?
      FROM safety_reports AS reports
      JOIN accounts AS reporter ON reporter.id = reports.reporter_account_id
      JOIN accounts AS target ON target.id = reports.target_account_id
      WHERE reports.reporter_account_id = ? OR reports.target_account_id = ?`)
      .bind(now, safetyArchiveExpiry, accountId, accountId),
    database.prepare(`UPDATE games
      SET white_name = 'Deleted player', white_token_hash = ?
      WHERE id IN (
        SELECT game_id FROM game_memberships
        WHERE account_id = ? AND color = 'w'
      )`)
      .bind(revokedWhiteToken, accountId),
    database.prepare(`UPDATE games
      SET black_name = 'Deleted player', black_token_hash = ?
      WHERE id IN (
        SELECT game_id FROM game_memberships
        WHERE account_id = ? AND color = 'b'
      )`)
      .bind(revokedBlackToken, accountId),
    database.prepare(`UPDATE games
      SET status = 'completed', winner_color = NULL, termination = 'cancelled',
        finished_at = ?, updated_at = ?, version = version + 1
      WHERE status <> 'completed' AND id IN (
        SELECT game_id FROM game_memberships WHERE account_id = ?
      )`)
      .bind(now, now, accountId),
    database.prepare(`DELETE FROM game_recap_shares WHERE game_id IN (
      SELECT game_id FROM game_memberships WHERE account_id = ?
    )`).bind(accountId),
    database.prepare("DELETE FROM game_memberships WHERE account_id = ?")
      .bind(accountId),
    database.prepare("DELETE FROM rate_limit_windows WHERE account_id = ?")
      .bind(accountId),
    database.prepare("DELETE FROM accounts WHERE id = ?")
      .bind(accountId),
  ]);
  return true;
}
