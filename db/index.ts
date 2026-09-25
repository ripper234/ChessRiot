import { accountIdSecret, appEnvironment, demoVideoBucket } from "@/lib/runtime";

let schemaPromise: Promise<void> | undefined;

declare global {
  var __CHESSRIOT_DB__: D1Database | undefined;
}

export function getDatabase(): D1Database {
  if (!globalThis.__CHESSRIOT_DB__) throw new Error("D1 binding DB is unavailable");
  return globalThis.__CHESSRIOT_DB__;
}

const STORAGE_CONTINUITY_OBJECT = "operations/chessriot-storage-epoch-v1.json";

async function accountIdentityMarker(environment: string): Promise<string> {
  const secret = accountIdSecret();
  if (!secret || secret.length < 32) {
    if (environment === "development" || environment === "production") {
      throw new Error("Account identity secret is unavailable");
    }
    return "unconfigured";
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`chessriot-account-identity\n${environment}\n${secret}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")).join("");
}

export interface RuntimeInvariantStatus {
  storageEpoch: string;
  environment: string;
}

async function verifyRuntimeInvariants(db: D1Database): Promise<RuntimeInvariantStatus> {
  const environment = appEnvironment();
  const marker = await accountIdentityMarker(environment);
  const bucket = demoVideoBucket();
  if ((environment === "development" || environment === "production") && !bucket) {
    throw new Error("Runtime continuity storage is unavailable");
  }
  let row = await db.prepare(`SELECT storage_epoch, environment, account_identity_marker
    FROM runtime_invariants WHERE id = 1`)
    .first<{
      storage_epoch: string;
      environment: string;
      account_identity_marker: string;
    }>();
  let mirror: { storageEpoch: string; environment: string } | null = null;
  if (bucket) {
    const object = await bucket.get(STORAGE_CONTINUITY_OBJECT);
    if (object) {
      try {
        const value: unknown = await object.json();
        if (
          value
          && typeof value === "object"
          && !Array.isArray(value)
          && typeof (value as { storageEpoch?: unknown }).storageEpoch === "string"
          && typeof (value as { environment?: unknown }).environment === "string"
        ) {
          mirror = value as { storageEpoch: string; environment: string };
        } else {
          throw new Error("Invalid continuity mirror");
        }
      } catch {
        throw new Error("Runtime continuity mirror is invalid");
      }
    }
  }
  if (!row) {
    if (mirror) throw new Error("Runtime database continuity check failed");
    const createdAt = new Date().toISOString();
    await db.prepare(`INSERT OR IGNORE INTO runtime_invariants (
        id, storage_epoch, environment, account_identity_marker, created_at
      ) VALUES (1, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), environment, marker, createdAt)
      .run();
    row = await db.prepare(`SELECT storage_epoch, environment, account_identity_marker
      FROM runtime_invariants WHERE id = 1`)
      .first<{
        storage_epoch: string;
        environment: string;
        account_identity_marker: string;
      }>();
  }
  if (!row || row.environment !== environment || row.account_identity_marker !== marker) {
    throw new Error("Runtime storage or account identity continuity check failed");
  }
  if (mirror && (
    mirror.storageEpoch !== row.storage_epoch
    || mirror.environment !== row.environment
  )) {
    throw new Error("Runtime database binding continuity check failed");
  }
  if (bucket && !mirror) {
    await bucket.put(STORAGE_CONTINUITY_OBJECT, JSON.stringify({
      storageEpoch: row.storage_epoch,
      environment: row.environment,
    }), {
      httpMetadata: { contentType: "application/json" },
    });
  }
  return { storageEpoch: row.storage_epoch, environment: row.environment };
}

export async function initializeRuntimeInvariants(): Promise<RuntimeInvariantStatus> {
  return verifyRuntimeInvariants(getDatabase());
}

export async function runtimeInvariantStatus(): Promise<RuntimeInvariantStatus> {
  const row = await getDatabase().prepare(`SELECT storage_epoch, environment
    FROM runtime_invariants WHERE id = 1`)
    .first<{ storage_epoch: string; environment: string }>();
  if (!row) throw new Error("Runtime invariants are unavailable");
  return { storageEpoch: row.storage_epoch, environment: row.environment };
}

export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    const db = getDatabase();
    schemaPromise = (async () => {
      // Sites applies the checked-in migrations before a hosted Worker serves
      // requests. Replaying DDL, legacy repairs and backfills on every new
      // isolate adds seconds to the first account and game read. Local/test
      // runtimes retain the bootstrap path below for disposable databases.
      if (appEnvironment() === "development" || appEnvironment() === "production") {
        await verifyRuntimeInvariants(db);
        return;
      }
      await db.batch([
        db.prepare(`CREATE TABLE IF NOT EXISTS games (
          id TEXT PRIMARY KEY NOT NULL,
          create_request_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'completed')),
          white_name TEXT NOT NULL,
          black_name TEXT,
          white_token_hash TEXT NOT NULL,
          black_token_hash TEXT,
          invite_token_hash TEXT NOT NULL UNIQUE,
          initial_fen TEXT NOT NULL,
          current_fen TEXT NOT NULL,
          turn_color TEXT NOT NULL CHECK (turn_color IN ('w', 'b')),
          version INTEGER NOT NULL DEFAULT 0,
          ply_count INTEGER NOT NULL DEFAULT 0,
          winner_color TEXT,
          termination TEXT,
          last_mutation_nonce TEXT,
          created_at TEXT NOT NULL,
          joined_at TEXT,
          updated_at TEXT NOT NULL,
          finished_at TEXT,
          CHECK (black_token_hash IS NULL OR black_token_hash <> white_token_hash)
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS games_created_idx ON games (created_at)"),
        db.prepare("CREATE INDEX IF NOT EXISTS games_finished_idx ON games (finished_at)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS runtime_invariants (
          id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
          storage_epoch TEXT NOT NULL UNIQUE,
          environment TEXT NOT NULL,
          account_identity_marker TEXT NOT NULL,
          created_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS moves (
          game_id TEXT NOT NULL,
          ply INTEGER NOT NULL,
          request_id TEXT NOT NULL,
          color TEXT NOT NULL CHECK (color IN ('w', 'b')),
          from_square TEXT NOT NULL,
          to_square TEXT NOT NULL,
          promotion TEXT,
          san TEXT NOT NULL,
          second_from_square TEXT,
          second_to_square TEXT,
          second_san TEXT,
          continuation_json TEXT,
          fen_before TEXT NOT NULL,
          fen_after TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (game_id, ply),
          UNIQUE (game_id, request_id),
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS moves_game_ply_idx ON moves (game_id, ply)"),
        db.prepare("CREATE INDEX IF NOT EXISTS moves_created_idx ON moves (created_at)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS magic_rule_compilations (
          cache_key TEXT PRIMARY KEY NOT NULL,
          compiler_version TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'compiled', 'ready')),
          rules_json TEXT,
          world_code TEXT,
          lease_token TEXT,
          lease_until INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (status = 'ready' AND rules_json IS NOT NULL AND world_code IS NOT NULL
              AND lease_token IS NULL AND lease_until IS NULL) OR
            (status = 'compiled' AND rules_json IS NOT NULL AND world_code IS NULL
              AND lease_token IS NULL AND lease_until IS NULL) OR
            (status = 'pending' AND rules_json IS NULL
              AND world_code IS NULL
              AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
          )
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS magic_rule_compilations_status_lease_idx
          ON magic_rule_compilations (status, lease_until)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS magic_rule_rejections (
          cache_key TEXT PRIMARY KEY NOT NULL,
          compiler_version TEXT NOT NULL,
          code TEXT NOT NULL CHECK (code IN ('unsupported', 'ambiguous')),
          created_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS game_settings (
          game_id TEXT PRIMARY KEY NOT NULL,
          game_mode TEXT NOT NULL DEFAULT 'multiplayer'
            CHECK (game_mode IN ('solo', 'multiplayer')),
          variant_id TEXT NOT NULL DEFAULT 'standard'
            CHECK (variant_id IN (
              'standard',
              'pawn-riot',
              'half-army',
              'pawn-duel',
              'mate-pawn',
              'mate-rook',
              'mate-two-bishops'
            )),
          ai_difficulty INTEGER
            CHECK (ai_difficulty IS NULL OR ai_difficulty BETWEEN 1 AND 5),
          human_color TEXT NOT NULL DEFAULT 'w'
            CHECK (human_color IN ('w', 'b')),
          turn_pace_days INTEGER
            CHECK (turn_pace_days IS NULL OR turn_pace_days IN (1, 3, 5)),
          magic_prompt TEXT,
          magic_rules_json TEXT,
          world_code TEXT,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
          CHECK (
            (game_mode = 'solo' AND ai_difficulty IS NOT NULL) OR
            (game_mode = 'multiplayer' AND ai_difficulty IS NULL)
          )
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY NOT NULL,
          display_name TEXT NOT NULL,
          username TEXT,
          username_canonical TEXT,
          username_set_at TEXT,
          tutorial_status TEXT NOT NULL DEFAULT 'skipped'
            CHECK (tutorial_status IN ('pending', 'completed', 'skipped')),
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          last_captcha_at TEXT NOT NULL
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS accounts_created_idx ON accounts (created_at)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS account_tombstones (
          account_id TEXT PRIMARY KEY NOT NULL,
          username_canonical TEXT NOT NULL UNIQUE,
          deleted_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS friend_requests (
          id TEXT PRIMARY KEY NOT NULL,
          pair_key TEXT NOT NULL UNIQUE,
          sender_account_id TEXT NOT NULL,
          recipient_account_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'accepted', 'declined')),
          created_at TEXT NOT NULL,
          responded_at TEXT,
          CHECK (sender_account_id <> recipient_account_id),
          FOREIGN KEY (sender_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (recipient_account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS friend_requests_sender_status_idx
          ON friend_requests (sender_account_id, status, created_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS friend_requests_recipient_status_idx
          ON friend_requests (recipient_account_id, status, created_at DESC)`),
        db.prepare("CREATE INDEX IF NOT EXISTS friend_requests_created_idx ON friend_requests (created_at)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS account_blocks (
          blocker_account_id TEXT NOT NULL,
          blocked_account_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (blocker_account_id, blocked_account_id),
          CHECK (blocker_account_id <> blocked_account_id),
          FOREIGN KEY (blocker_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (blocked_account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS account_blocks_blocked_idx
          ON account_blocks (blocked_account_id, created_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS account_notifications (
          id TEXT PRIMARY KEY NOT NULL,
          recipient_account_id TEXT NOT NULL,
          actor_account_id TEXT,
          game_id TEXT,
          kind TEXT NOT NULL
            CHECK (kind IN ('friend_request', 'challenge', 'turn', 'result')),
          source_key TEXT NOT NULL,
          created_at TEXT NOT NULL,
          read_at TEXT,
          UNIQUE (recipient_account_id, source_key),
          FOREIGN KEY (recipient_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (actor_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS account_notifications_recipient_time_idx
          ON account_notifications (recipient_account_id, created_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS safety_reports (
          id TEXT PRIMARY KEY NOT NULL,
          reporter_account_id TEXT NOT NULL,
          target_account_id TEXT NOT NULL,
          category TEXT NOT NULL
            CHECK (category IN ('spam', 'harassment', 'inappropriate_username', 'cheating', 'other')),
          note TEXT,
          status TEXT NOT NULL DEFAULT 'new'
            CHECK (status IN ('new', 'reviewed', 'closed')),
          created_at TEXT NOT NULL,
          CHECK (reporter_account_id <> target_account_id),
          FOREIGN KEY (reporter_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (target_account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS safety_reports_status_time_idx
          ON safety_reports (status, created_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS safety_reports_reporter_time_idx
          ON safety_reports (reporter_account_id, created_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS safety_report_archive (
          id TEXT PRIMARY KEY NOT NULL,
          reporter_username TEXT NOT NULL,
          target_username TEXT NOT NULL,
          category TEXT NOT NULL
            CHECK (category IN ('spam', 'harassment', 'inappropriate_username', 'cheating', 'other')),
          note TEXT,
          status TEXT NOT NULL
            CHECK (status IN ('new', 'reviewed', 'closed')),
          created_at TEXT NOT NULL,
          archived_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS safety_report_archive_status_time_idx
          ON safety_report_archive (status, created_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS safety_report_archive_expiry_idx
          ON safety_report_archive (expires_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS public_rate_limit_windows (
          key TEXT PRIMARY KEY NOT NULL,
          scope TEXT NOT NULL,
          hit_count INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS public_rate_limit_expiry_idx
          ON public_rate_limit_windows (expires_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS referral_links (
          account_id TEXT PRIMARY KEY NOT NULL,
          code TEXT NOT NULL UNIQUE
            CHECK (length(code) = 16 AND code NOT GLOB '*[^A-Za-z0-9_-]*'),
          created_at TEXT NOT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS referral_attributions (
          referred_account_id TEXT PRIMARY KEY NOT NULL,
          referrer_account_id TEXT NOT NULL,
          referral_code TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'rewarded')),
          credits INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          completed_at TEXT,
          CHECK (referrer_account_id <> referred_account_id),
          CHECK (
            (status = 'pending' AND credits = 0 AND completed_at IS NULL) OR
            (status = 'rewarded' AND credits > 0 AND completed_at IS NOT NULL)
          ),
          FOREIGN KEY (referred_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (referrer_account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (referral_code) REFERENCES referral_links(code) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS referral_attributions_referrer_status_idx
          ON referral_attributions (referrer_account_id, status, created_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS referral_attributions_status_completed_idx
          ON referral_attributions (status, completed_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS account_credit_ledger (
          id TEXT PRIMARY KEY NOT NULL,
          account_id TEXT NOT NULL,
          amount INTEGER NOT NULL CHECK (amount <> 0),
          reason TEXT NOT NULL CHECK (
            reason IN ('starter', 'referral', 'magic_spend', 'magic_refund', 'world_royalty')
          ),
          source_key TEXT NOT NULL UNIQUE,
          world_code TEXT,
          game_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS account_credit_ledger_account_time_idx
          ON account_credit_ledger (account_id, created_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS account_credit_ledger_world_time_idx
          ON account_credit_ledger (world_code, created_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS magic_worlds (
          code TEXT PRIMARY KEY NOT NULL,
          full_hash TEXT NOT NULL UNIQUE,
          canonical_code TEXT NOT NULL UNIQUE,
          rules_json TEXT NOT NULL,
          creator_account_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (creator_account_id) REFERENCES accounts(id) ON DELETE SET NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS magic_worlds_creator_time_idx
          ON magic_worlds (creator_account_id, created_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS magic_world_sources (
          source_key TEXT PRIMARY KEY NOT NULL,
          world_code TEXT NOT NULL,
          contributor_account_id TEXT,
          prompt_hash TEXT,
          compiler_version TEXT NOT NULL,
          parent_code TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('create', 'rediscover', 'fork', 'play')),
          created_at TEXT NOT NULL,
          FOREIGN KEY (world_code) REFERENCES magic_worlds(code) ON DELETE CASCADE,
          FOREIGN KEY (contributor_account_id) REFERENCES accounts(id) ON DELETE SET NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS magic_world_sources_world_time_idx
          ON magic_world_sources (world_code, created_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS magic_world_sources_contributor_time_idx
          ON magic_world_sources (contributor_account_id, created_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS magic_world_derivations (
          parent_code TEXT NOT NULL,
          child_code TEXT NOT NULL,
          created_by_account_id TEXT,
          created_at TEXT NOT NULL,
          PRIMARY KEY (parent_code, child_code),
          CHECK (parent_code <> child_code),
          FOREIGN KEY (parent_code) REFERENCES magic_worlds(code) ON DELETE CASCADE,
          FOREIGN KEY (child_code) REFERENCES magic_worlds(code) ON DELETE CASCADE,
          FOREIGN KEY (created_by_account_id) REFERENCES accounts(id) ON DELETE SET NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS magic_world_derivations_child_idx
          ON magic_world_derivations (child_code, created_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS magic_world_entitlements (
          game_create_request_id TEXT PRIMARY KEY NOT NULL,
          account_id TEXT NOT NULL,
          world_code TEXT NOT NULL,
          request_fingerprint TEXT NOT NULL,
          created_at TEXT NOT NULL,
          consumed_at TEXT,
          game_id TEXT,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
          FOREIGN KEY (world_code) REFERENCES magic_worlds(code) ON DELETE CASCADE,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE SET NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS magic_world_entitlements_account_time_idx
          ON magic_world_entitlements (account_id, created_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS magic_world_entitlements_world_time_idx
          ON magic_world_entitlements (world_code, created_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS magic_world_uses (
          game_id TEXT PRIMARY KEY NOT NULL,
          world_code TEXT NOT NULL,
          spender_account_id TEXT,
          creator_account_id TEXT,
          qualifies_for_royalty INTEGER NOT NULL DEFAULT 0 CHECK (qualifies_for_royalty IN (0, 1)),
          human_played_at TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
          FOREIGN KEY (world_code) REFERENCES magic_worlds(code) ON DELETE CASCADE,
          FOREIGN KEY (spender_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
          FOREIGN KEY (creator_account_id) REFERENCES accounts(id) ON DELETE SET NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS magic_world_uses_world_time_idx
          ON magic_world_uses (world_code, created_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS magic_world_uses_creator_qualifies_idx
          ON magic_world_uses (creator_account_id, qualifies_for_royalty, created_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS account_feature_flags (
          account_id TEXT NOT NULL,
          feature_key TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
          updated_at TEXT NOT NULL,
          PRIMARY KEY (account_id, feature_key),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS account_feature_flags_feature_idx
          ON account_feature_flags (feature_key, enabled)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS feature_access_requests (
          id TEXT PRIMARY KEY NOT NULL,
          account_id TEXT NOT NULL,
          feature_key TEXT NOT NULL,
          requested_at TEXT NOT NULL,
          UNIQUE (account_id, feature_key),
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS feature_access_requests_feature_time_idx
          ON feature_access_requests (feature_key, requested_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS game_recap_shares (
          id TEXT PRIMARY KEY NOT NULL,
          game_id TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS push_subscriptions (
          id TEXT PRIMARY KEY NOT NULL,
          game_id TEXT NOT NULL,
          color TEXT NOT NULL CHECK (color IN ('w', 'b')),
          account_id TEXT NOT NULL,
          endpoint_hash TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          expiration_time INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_success_at TEXT,
          failure_count INTEGER NOT NULL DEFAULT 0,
          disabled_at TEXT,
          UNIQUE (game_id, color, endpoint_hash),
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS push_subscriptions_game_color_updated_idx
          ON push_subscriptions (game_id, color, updated_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS push_devices (
          id TEXT PRIMARY KEY NOT NULL,
          account_id TEXT NOT NULL,
          endpoint_hash TEXT NOT NULL UNIQUE,
          endpoint TEXT NOT NULL,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          expiration_time INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_success_at TEXT,
          failure_count INTEGER NOT NULL DEFAULT 0,
          disabled_at TEXT,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS push_devices_account_updated_idx
          ON push_devices (account_id, updated_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS push_deliveries (
          id TEXT PRIMARY KEY NOT NULL,
          subscription_id TEXT NOT NULL,
          game_id TEXT NOT NULL,
          game_version INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('your_turn')),
          status TEXT NOT NULL CHECK (status IN (
            'pending', 'sent', 'failed', 'stale', 'dead', 'superseded'
          )),
          status_code INTEGER,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL DEFAULT 0,
          lease_token TEXT,
          lease_until INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (subscription_id, game_id, game_version, kind),
          FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS push_deliveries_created_idx
          ON push_deliveries (created_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS push_deliveries_due_idx
          ON push_deliveries (status, next_attempt_at, lease_until)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS push_turn_deliveries (
          id TEXT PRIMARY KEY NOT NULL,
          device_id TEXT NOT NULL,
          game_id TEXT NOT NULL,
          game_version INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('your_turn')),
          status TEXT NOT NULL CHECK (status IN (
            'pending', 'sent', 'failed', 'stale', 'dead', 'superseded'
          )),
          status_code INTEGER,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL DEFAULT 0,
          lease_token TEXT,
          lease_until INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (device_id, game_id, game_version, kind),
          FOREIGN KEY (device_id) REFERENCES push_devices(id) ON DELETE CASCADE,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS push_turn_deliveries_created_idx
          ON push_turn_deliveries (created_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS push_turn_deliveries_due_idx
          ON push_turn_deliveries (status, next_attempt_at, lease_until)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS push_account_deliveries (
          id TEXT PRIMARY KEY NOT NULL,
          device_id TEXT NOT NULL,
          friend_request_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('friend_request')),
          status TEXT NOT NULL CHECK (status IN (
            'pending', 'sent', 'failed', 'stale', 'dead', 'superseded'
          )),
          status_code INTEGER,
          attempt_count INTEGER NOT NULL DEFAULT 0,
          next_attempt_at INTEGER NOT NULL DEFAULT 0,
          lease_token TEXT,
          lease_until INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (device_id, friend_request_id, kind),
          FOREIGN KEY (device_id) REFERENCES push_devices(id) ON DELETE CASCADE,
          FOREIGN KEY (friend_request_id) REFERENCES friend_requests(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS push_account_deliveries_created_idx
          ON push_account_deliveries (created_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS push_account_deliveries_due_idx
          ON push_account_deliveries (status, next_attempt_at, lease_until)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS game_memberships (
          game_id TEXT NOT NULL,
          color TEXT NOT NULL CHECK (color IN ('w', 'b')),
          account_id TEXT NOT NULL,
          claimed_at TEXT NOT NULL,
          PRIMARY KEY (game_id, color),
          UNIQUE (game_id, account_id),
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
          FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS game_memberships_account_idx
          ON game_memberships (account_id, claimed_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS rate_limit_windows (
          key TEXT PRIMARY KEY NOT NULL,
          account_id TEXT NOT NULL,
          scope TEXT NOT NULL,
          window_start INTEGER NOT NULL,
          hit_count INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS rate_limit_expiry_idx
          ON rate_limit_windows (expires_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS bot_turn_leases (
          game_id TEXT PRIMARY KEY NOT NULL,
          game_version INTEGER NOT NULL,
          nonce TEXT NOT NULL,
          lease_until TEXT NOT NULL,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS game_actions (
          game_id TEXT NOT NULL,
          request_id TEXT NOT NULL,
          action_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (game_id, request_id),
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS game_reactions (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          id TEXT NOT NULL UNIQUE,
          game_id TEXT NOT NULL,
          request_id TEXT NOT NULL,
          sender_color TEXT NOT NULL CHECK (sender_color IN ('w', 'b')),
          reaction_key TEXT NOT NULL CHECK (
            reaction_key IN ('hi', 'good_luck', 'nice_move', 'well_played', 'good_game', 'thanks')
          ),
          created_at TEXT NOT NULL,
          UNIQUE (game_id, request_id),
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS game_reactions_game_sequence_idx
          ON game_reactions (game_id, sequence DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS observability_events (
          id TEXT PRIMARY KEY NOT NULL,
          occurred_at TEXT NOT NULL,
          environment TEXT NOT NULL,
          app_version TEXT NOT NULL,
          event_name TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'failure')),
          request_id TEXT,
          subject_hash TEXT,
          actor_hash TEXT,
          route TEXT,
          method TEXT,
          status_code INTEGER,
          error_code TEXT,
          latency_ms INTEGER,
          metadata_json TEXT
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS observability_time_idx ON observability_events (occurred_at DESC)"),
        db.prepare("CREATE INDEX IF NOT EXISTS observability_event_time_idx ON observability_events (event_name, occurred_at DESC)"),
        db.prepare("CREATE INDEX IF NOT EXISTS observability_outcome_time_idx ON observability_events (outcome, occurred_at DESC)"),
        db.prepare("CREATE INDEX IF NOT EXISTS observability_subject_time_idx ON observability_events (subject_hash, occurred_at DESC)"),
        db.prepare("CREATE INDEX IF NOT EXISTS observability_actor_time_idx ON observability_events (actor_hash, occurred_at DESC)"),
        db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS observability_client_request_unique
          ON observability_events (request_id)
          WHERE event_name IN (
            'client.error', 'client.unhandled_rejection', 'client.network_error',
            'public.home_viewed', 'demo.started', 'demo.completed', 'auth.started',
            'tutorial.started', 'tutorial.completed', 'tutorial.skipped', 'activity.opened'
          )`),
        db.prepare(`CREATE TRIGGER IF NOT EXISTS observability_hard_cap
          AFTER INSERT ON observability_events
          BEGIN
            DELETE FROM observability_events
            WHERE id IN (
              SELECT id FROM observability_events
              ORDER BY occurred_at DESC
              LIMIT -1 OFFSET 20000
            );
          END`),
        db.prepare(`CREATE TABLE IF NOT EXISTS feedback (
          id TEXT PRIMARY KEY NOT NULL,
          request_id TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          comment TEXT,
          page TEXT NOT NULL,
          environment TEXT NOT NULL,
          app_version TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'new'
            CHECK (status IN ('new', 'reviewed', 'closed')),
          created_at TEXT NOT NULL
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback (created_at DESC)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS demo_video_jobs (
          id TEXT PRIMARY KEY NOT NULL,
          status TEXT NOT NULL
            CHECK (status IN ('narrating', 'rendering', 'publishing', 'ready', 'failed')),
          requested_at TEXT NOT NULL,
          narration_ready_at TEXT,
          published_at TEXT,
          duration_seconds INTEGER,
          size_bytes INTEGER,
          media_key TEXT,
          error_code TEXT
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS demo_video_jobs_requested_idx
          ON demo_video_jobs (requested_at DESC)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS demo_video_generation_lock (
          id INTEGER PRIMARY KEY NOT NULL
            CHECK (id = 1),
          job_id TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS demo_video_nonces (
          nonce TEXT PRIMARY KEY NOT NULL,
          used_at TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS demo_video_nonces_expiry_idx
          ON demo_video_nonces (expires_at)`),
        db.prepare(`CREATE TABLE IF NOT EXISTS ops_action_nonces (
          nonce TEXT PRIMARY KEY NOT NULL,
          scope TEXT NOT NULL,
          subject_key TEXT,
          used_at TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          result_json TEXT
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS ops_action_nonces_scope_used_idx
          ON ops_action_nonces (scope, used_at DESC)`),
        db.prepare(`CREATE INDEX IF NOT EXISTS ops_action_nonces_expiry_idx
          ON ops_action_nonces (expires_at)`),
      ]);

      const columns = await db
        .prepare("PRAGMA table_info(game_settings)")
        .all<{ name: string }>();
      if (!(columns.results ?? []).some((column) => column.name === "human_color")) {
        try {
          await db
            .prepare(`ALTER TABLE game_settings
              ADD COLUMN human_color TEXT NOT NULL DEFAULT 'w'
              CHECK (human_color IN ('w', 'b'))`)
            .run();
        } catch (error) {
          const reloaded = await db
            .prepare("PRAGMA table_info(game_settings)")
            .all<{ name: string }>();
          if (!(reloaded.results ?? []).some((column) => column.name === "human_color")) {
            throw error;
          }
        }
      }
      const updatedColumns = await db
        .prepare("PRAGMA table_info(game_settings)")
        .all<{ name: string }>();
      if (!(updatedColumns.results ?? []).some((column) => column.name === "turn_pace_days")) {
        try {
          await db
            .prepare(`ALTER TABLE game_settings
              ADD COLUMN turn_pace_days INTEGER
              CHECK (turn_pace_days IS NULL OR turn_pace_days IN (1, 3, 5))`)
            .run();
        } catch (error) {
          const reloaded = await db
            .prepare("PRAGMA table_info(game_settings)")
            .all<{ name: string }>();
          if (!(reloaded.results ?? []).some((column) => column.name === "turn_pace_days")) {
            throw error;
          }
        }
      }
      const finalSettingsColumns = await db
        .prepare("PRAGMA table_info(game_settings)")
        .all<{ name: string }>();
      for (const column of [
        {
          name: "variant_id",
          sql: `ALTER TABLE game_settings
            ADD COLUMN variant_id TEXT NOT NULL DEFAULT 'standard'
            CHECK (variant_id IN (
              'standard',
              'pawn-riot',
              'half-army',
              'pawn-duel',
              'mate-pawn',
              'mate-rook',
              'mate-two-bishops'
            ))`,
        },
        { name: "magic_prompt", sql: "ALTER TABLE game_settings ADD COLUMN magic_prompt TEXT" },
        { name: "magic_rules_json", sql: "ALTER TABLE game_settings ADD COLUMN magic_rules_json TEXT" },
        { name: "world_code", sql: "ALTER TABLE game_settings ADD COLUMN world_code TEXT" },
      ]) {
        if ((finalSettingsColumns.results ?? []).some((current) => current.name === column.name)) {
          continue;
        }
        try {
          await db.prepare(column.sql).run();
        } catch (error) {
          const reloaded = await db
            .prepare("PRAGMA table_info(game_settings)")
            .all<{ name: string }>();
          if (!(reloaded.results ?? []).some((current) => current.name === column.name)) {
            throw error;
          }
        }
      }
      await db.prepare(`CREATE INDEX IF NOT EXISTS game_settings_world_idx
        ON game_settings (world_code)`).run();

      const compilationColumns = await db
        .prepare("PRAGMA table_info(magic_rule_compilations)")
        .all<{ name: string }>();
      if (!(compilationColumns.results ?? []).some((column) => column.name === "world_code")) {
        try {
          await db.prepare("ALTER TABLE magic_rule_compilations ADD COLUMN world_code TEXT").run();
        } catch (error) {
          const reloaded = await db
            .prepare("PRAGMA table_info(magic_rule_compilations)")
            .all<{ name: string }>();
          if (!(reloaded.results ?? []).some((column) => column.name === "world_code")) {
            throw error;
          }
        }
      }

      const entitlementColumns = await db
        .prepare("PRAGMA table_info(magic_world_entitlements)")
        .all<{ name: string }>();
      if (!(entitlementColumns.results ?? []).some((column) => column.name === "request_fingerprint")) {
        await db.prepare("ALTER TABLE magic_world_entitlements ADD COLUMN request_fingerprint TEXT").run();
      }
      const worldUseColumns = await db
        .prepare("PRAGMA table_info(magic_world_uses)")
        .all<{ name: string }>();
      if (!(worldUseColumns.results ?? []).some((column) => column.name === "human_played_at")) {
        await db.prepare("ALTER TABLE magic_world_uses ADD COLUMN human_played_at TEXT").run();
      }

      const moveColumns = await db
        .prepare("PRAGMA table_info(moves)")
        .all<{ name: string }>();
      for (const column of [
        { name: "second_from_square", sql: "ALTER TABLE moves ADD COLUMN second_from_square TEXT" },
        { name: "second_to_square", sql: "ALTER TABLE moves ADD COLUMN second_to_square TEXT" },
        { name: "second_san", sql: "ALTER TABLE moves ADD COLUMN second_san TEXT" },
        { name: "continuation_json", sql: "ALTER TABLE moves ADD COLUMN continuation_json TEXT" },
      ]) {
        if ((moveColumns.results ?? []).some((current) => current.name === column.name)) {
          continue;
        }
        try {
          await db.prepare(column.sql).run();
        } catch (error) {
          const reloaded = await db
            .prepare("PRAGMA table_info(moves)")
            .all<{ name: string }>();
          if (!(reloaded.results ?? []).some((current) => current.name === column.name)) {
            throw error;
          }
        }
      }

      const accountColumns = await db
        .prepare("PRAGMA table_info(accounts)")
        .all<{ name: string }>();
      for (const column of [
        { name: "username", sql: "ALTER TABLE accounts ADD COLUMN username TEXT" },
        {
          name: "username_canonical",
          sql: "ALTER TABLE accounts ADD COLUMN username_canonical TEXT",
        },
        {
          name: "username_set_at",
          sql: "ALTER TABLE accounts ADD COLUMN username_set_at TEXT",
        },
        {
          name: "tutorial_status",
          sql: `ALTER TABLE accounts ADD COLUMN tutorial_status TEXT NOT NULL DEFAULT 'skipped'
            CHECK (tutorial_status IN ('pending', 'completed', 'skipped'))`,
        },
      ]) {
        if ((accountColumns.results ?? []).some((current) => current.name === column.name)) {
          continue;
        }
        try {
          await db.prepare(column.sql).run();
        } catch (error) {
          const reloaded = await db
            .prepare("PRAGMA table_info(accounts)")
            .all<{ name: string }>();
          if (!(reloaded.results ?? []).some((current) => current.name === column.name)) {
            throw error;
          }
        }
      }
      await db
        .prepare(`CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_canonical_unique
          ON accounts (username_canonical)`)
        .run();

      const observabilityColumns = await db
        .prepare("PRAGMA table_info(observability_events)")
        .all<{ name: string }>();
      if (!(observabilityColumns.results ?? []).some((column) => column.name === "actor_hash")) {
        try {
          await db.prepare("ALTER TABLE observability_events ADD COLUMN actor_hash TEXT").run();
        } catch (error) {
          const reloaded = await db
            .prepare("PRAGMA table_info(observability_events)")
            .all<{ name: string }>();
          if (!(reloaded.results ?? []).some((column) => column.name === "actor_hash")) {
            throw error;
          }
        }
      }

      await db.prepare(`UPDATE referral_attributions SET credits = 10
        WHERE status = 'rewarded' AND credits <> 10`).run();
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO account_credit_ledger (
          id, account_id, amount, reason, source_key, created_at
        ) SELECT 'starter:' || id, id, 10, 'starter', 'starter:' || id, created_at
          FROM accounts`),
        db.prepare(`INSERT OR IGNORE INTO account_credit_ledger (
          id, account_id, amount, reason, source_key, created_at
        ) SELECT
          'referral:' || referred_account_id,
          referrer_account_id,
          10,
          'referral',
          'referral:' || referred_account_id,
          COALESCE(completed_at, created_at)
          FROM referral_attributions
          WHERE status = 'rewarded'`),
      ]);
      await verifyRuntimeInvariants(db);
    })().catch((error: unknown) => {
        schemaPromise = undefined;
        throw error;
      });
  }
  return schemaPromise;
}
