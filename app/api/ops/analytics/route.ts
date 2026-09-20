import { getDatabase } from "@/db";
import { authorizeOpsRead, opsCorsHeaders } from "@/lib/ops-auth";
import { appEnvironment } from "@/lib/runtime";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

interface AcquisitionRow {
  homepage_views: number;
  demo_starts: number;
  demo_completions: number;
  auth_starts: number;
  auth_completions: number;
}

interface FunnelRow {
  accounts: number;
  usernames: number;
  game_started: number;
  first_move: number;
}

interface JourneyRow {
  created_at: string;
  username_set_at: string | null;
  first_game_at: string | null;
  first_move_at: string | null;
}

interface EngagementRow {
  games_created: number;
  games_completed: number;
  successful_moves: number;
  friend_requests: number;
  rewarded_referrals: number;
}

interface QualityRow {
  client_errors: number;
  api_failures: number;
}

function count(value: number | null | undefined): number {
  return Number(value ?? 0);
}

function withinHours(value: string | null, start: string, hours: number): boolean {
  if (!value) return false;
  const elapsed = Date.parse(value) - Date.parse(start);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= hours * 60 * 60_000;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const headers = opsCorsHeaders(origin);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!(await authorizeOpsRead(request))) {
    return new Response(JSON.stringify({ error: "not_authorized" }), { status: 403, headers });
  }

  const rawDays = Number(new URL(request.url).searchParams.get("window") ?? "30");
  const days = rawDays === 1 || rawDays === 7 || rawDays === 30 ? rawDays : 30;
  const until = new Date();
  const since = new Date(until.getTime() - days * 24 * 60 * 60_000);
  const sinceIso = since.toISOString();
  const journeySince = new Date(until.getTime() - 7 * 24 * 60 * 60_000);
  const journeyMatureBefore = new Date(until.getTime() - 24 * 60 * 60_000);
  const database = getDatabase();

  // Keep this owner-only read to one D1 round trip. Runtime schema creation is
  // intentionally omitted here: hosted migrations own the schema, while the
  // old per-isolate bootstrap plus ten independent reads could exceed
  // Control's deadline on a cold worker.
  const analyticsResults = await database.batch([
    database.prepare(`SELECT
      SUM(CASE WHEN event_name = 'public.home_viewed' AND outcome = 'success' THEN 1 ELSE 0 END) AS homepage_views,
      SUM(CASE WHEN event_name = 'demo.started' AND outcome = 'success' THEN 1 ELSE 0 END) AS demo_starts,
      SUM(CASE WHEN event_name = 'demo.completed' AND outcome = 'success' THEN 1 ELSE 0 END) AS demo_completions,
      SUM(CASE WHEN event_name = 'auth.started' AND outcome = 'success' THEN 1 ELSE 0 END) AS auth_starts,
      SUM(CASE WHEN event_name = 'auth.completed' AND outcome = 'success' THEN 1 ELSE 0 END) AS auth_completions
      FROM observability_events WHERE occurred_at >= ?`)
      .bind(sinceIso),
    database.prepare(`SELECT
      COUNT(*) AS accounts,
      SUM(CASE WHEN accounts.username_set_at IS NOT NULL THEN 1 ELSE 0 END) AS usernames,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM game_memberships WHERE game_memberships.account_id = accounts.id
      ) THEN 1 ELSE 0 END) AS game_started,
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM game_memberships
        JOIN moves ON moves.game_id = game_memberships.game_id
          AND moves.color = game_memberships.color
        WHERE game_memberships.account_id = accounts.id
      ) THEN 1 ELSE 0 END) AS first_move
      FROM accounts WHERE accounts.created_at >= ?`)
      .bind(sinceIso),
    database.prepare(`SELECT COUNT(DISTINCT actor_hash) AS total
      FROM observability_events
      WHERE occurred_at >= ? AND actor_hash IS NOT NULL AND outcome = 'success'`)
      .bind(sinceIso),
    database.prepare(`SELECT COUNT(*) AS total FROM (
      SELECT actor_hash FROM observability_events
      WHERE occurred_at >= ? AND actor_hash IS NOT NULL AND outcome = 'success'
      GROUP BY actor_hash HAVING COUNT(DISTINCT substr(occurred_at, 1, 10)) >= 2
    )`)
      .bind(sinceIso),
    database.prepare(`SELECT
      (SELECT COUNT(*) FROM games WHERE created_at >= ?) AS games_created,
      (SELECT COUNT(*) FROM games WHERE finished_at >= ?) AS games_completed,
      (SELECT COUNT(*) FROM moves WHERE created_at >= ?) AS successful_moves,
      (SELECT COUNT(*) FROM friend_requests WHERE created_at >= ?) AS friend_requests,
      (SELECT COUNT(*) FROM referral_attributions WHERE completed_at >= ? AND status = 'rewarded') AS rewarded_referrals`)
      .bind(sinceIso, sinceIso, sinceIso, sinceIso, sinceIso),
    database.prepare(`SELECT
      SUM(CASE WHEN event_name IN ('client.error','client.unhandled_rejection','client.network_error') THEN 1 ELSE 0 END) AS client_errors,
      SUM(CASE WHEN event_name = 'api.request' AND outcome = 'failure' THEN 1 ELSE 0 END) AS api_failures
      FROM observability_events WHERE occurred_at >= ?`)
      .bind(sinceIso),
    database.prepare(`SELECT accounts.created_at, accounts.username_set_at,
        (SELECT MIN(memberships.claimed_at)
          FROM game_memberships AS memberships
          WHERE memberships.account_id = accounts.id) AS first_game_at,
        (SELECT MIN(moves.created_at)
          FROM game_memberships AS memberships
          JOIN moves ON moves.game_id = memberships.game_id
            AND moves.color = memberships.color
          WHERE memberships.account_id = accounts.id) AS first_move_at
      FROM accounts
      WHERE accounts.created_at >= ? AND accounts.created_at < ?
      ORDER BY accounts.created_at`)
      .bind(journeySince.toISOString(), journeyMatureBefore.toISOString()),
  ]);

  const acquisition = analyticsResults[0]?.results?.[0] as AcquisitionRow | undefined;
  const funnel = analyticsResults[1]?.results?.[0] as FunnelRow | undefined;
  const active = analyticsResults[2]?.results?.[0] as { total: number } | undefined;
  const returning = analyticsResults[3]?.results?.[0] as { total: number } | undefined;
  const engagement = analyticsResults[4]?.results?.[0] as EngagementRow | undefined;
  const quality = analyticsResults[5]?.results?.[0] as QualityRow | undefined;
  const journeyAccounts = (analyticsResults[6]?.results ?? []) as JourneyRow[];

  const normalizedFunnel = funnel ?? { accounts: 0, usernames: 0, game_started: 0, first_move: 0 };
  const journeyRows = journeyAccounts;
  const journeyUsername = journeyRows.filter((row) => withinHours(
    row.username_set_at,
    row.created_at,
    24,
  )).length;
  const journeyGame = journeyRows.filter((row) => withinHours(
    row.first_game_at,
    row.created_at,
    24,
  )).length;
  const journeyMoveRows = journeyRows.filter((row) => withinHours(
    row.first_move_at,
    row.created_at,
    24,
  ));
  const journeyMedianMinutes = median(journeyMoveRows.map((row) => (
    Date.parse(row.first_move_at!) - Date.parse(row.created_at)
  ) / 60_000));
  return new Response(JSON.stringify({
    status: "ok",
    environment: appEnvironment(),
    version: APP_VERSION,
    generatedAt: until.toISOString(),
    window: { days, since: sinceIso, until: until.toISOString(), bucketTimezone: "UTC" },
    privacy: {
      source: "first_party_aggregate",
      retentionDays: 30,
      identifiersReturned: false,
      crossEnvironmentJoin: false,
    },
    acquisition: {
      homepageViews: count(acquisition?.homepage_views),
      demoStarts: count(acquisition?.demo_starts),
      demoCompletions: count(acquisition?.demo_completions),
      authStarts: count(acquisition?.auth_starts),
      authCompletions: count(acquisition?.auth_completions),
    },
    newAccountFunnel: {
      cohort: "accounts created inside the selected window",
      steps: [
        { key: "account", label: "Google account", accounts: count(normalizedFunnel.accounts) },
        { key: "username", label: "Username chosen", accounts: count(normalizedFunnel.usernames) },
        { key: "game_started", label: "Game started", accounts: count(normalizedFunnel.game_started) },
        { key: "first_move", label: "First move", accounts: count(normalizedFunnel.first_move) },
      ],
    },
    journeyMonitor: {
      definitionVersion: 1,
      definition: "Accounts created 24 hours to 7 days ago; each stage must occur within 24 hours of signup.",
      cohort: {
        since: journeySince.toISOString(),
        matureBefore: journeyMatureBefore.toISOString(),
        lookbackDays: 7,
        maturityHours: 24,
      },
      stages: [
        { key: "account", label: "Signed up", accounts: journeyRows.length },
        { key: "username", label: "Username within 24h", accounts: journeyUsername },
        { key: "game_started", label: "Game within 24h", accounts: journeyGame },
        { key: "first_move", label: "First move within 24h", accounts: journeyMoveRows.length },
      ],
      medianMinutesToFirstMove: journeyMedianMinutes === null
        ? null
        : Math.round(journeyMedianMinutes * 10) / 10,
    },
    engagement: {
      activeAccounts: count(active?.total),
      returningAccounts: count(returning?.total),
      gamesCreated: count(engagement?.games_created),
      gamesCompleted: count(engagement?.games_completed),
      successfulMoves: count(engagement?.successful_moves),
      friendRequests: count(engagement?.friend_requests),
      rewardedReferrals: count(engagement?.rewarded_referrals),
    },
    quality: {
      authFailures: null,
      clientErrors: count(quality?.client_errors),
      apiFailures: count(quality?.api_failures),
      instrumentation: { authFailures: false },
    },
  }), { headers });
}
