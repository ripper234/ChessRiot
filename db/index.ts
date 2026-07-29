let schemaPromise: Promise<void> | undefined;

declare global {
  var __CHESSRIOT_DB__: D1Database | undefined;
}

export function getDatabase(): D1Database {
  if (!globalThis.__CHESSRIOT_DB__) throw new Error("D1 binding DB is unavailable");
  return globalThis.__CHESSRIOT_DB__;
}

export async function ensureSchema(): Promise<void> {
  if (!schemaPromise) {
    const db = getDatabase();
    schemaPromise = (async () => {
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
          fen_before TEXT NOT NULL,
          fen_after TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (game_id, ply),
          UNIQUE (game_id, request_id),
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`),
        db.prepare("CREATE INDEX IF NOT EXISTS moves_game_ply_idx ON moves (game_id, ply)"),
        db.prepare(`CREATE TABLE IF NOT EXISTS game_settings (
          game_id TEXT PRIMARY KEY NOT NULL,
          game_mode TEXT NOT NULL DEFAULT 'multiplayer'
            CHECK (game_mode IN ('solo', 'multiplayer')),
          variant_id TEXT NOT NULL DEFAULT 'standard'
            CHECK (variant_id IN ('standard', 'pawn-riot', 'half-army', 'pawn-duel')),
          ai_difficulty INTEGER
            CHECK (ai_difficulty IS NULL OR ai_difficulty BETWEEN 1 AND 5),
          human_color TEXT NOT NULL DEFAULT 'w'
            CHECK (human_color IN ('w', 'b')),
          turn_pace_days INTEGER
            CHECK (turn_pace_days IS NULL OR turn_pace_days IN (1, 3, 5)),
          magic_prompt TEXT,
          magic_rules_json TEXT,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
          CHECK (
            (game_mode = 'solo' AND ai_difficulty IS NOT NULL) OR
            (game_mode = 'multiplayer' AND ai_difficulty IS NULL)
          )
        )`),
        db.prepare(`CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY NOT NULL,
          display_name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          last_captcha_at TEXT NOT NULL
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
        db.prepare(`CREATE TABLE IF NOT EXISTS push_deliveries (
          id TEXT PRIMARY KEY NOT NULL,
          subscription_id TEXT NOT NULL,
          game_id TEXT NOT NULL,
          game_version INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('your_turn')),
          status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'stale')),
          status_code INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (subscription_id, game_id, game_version, kind),
          FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE,
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
        )`),
        db.prepare(`CREATE INDEX IF NOT EXISTS push_deliveries_created_idx
          ON push_deliveries (created_at DESC)`),
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
            CHECK (variant_id IN ('standard', 'pawn-riot', 'half-army', 'pawn-duel'))`,
        },
        { name: "magic_prompt", sql: "ALTER TABLE game_settings ADD COLUMN magic_prompt TEXT" },
        { name: "magic_rules_json", sql: "ALTER TABLE game_settings ADD COLUMN magic_rules_json TEXT" },
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

      const moveColumns = await db
        .prepare("PRAGMA table_info(moves)")
        .all<{ name: string }>();
      for (const column of [
        { name: "second_from_square", sql: "ALTER TABLE moves ADD COLUMN second_from_square TEXT" },
        { name: "second_to_square", sql: "ALTER TABLE moves ADD COLUMN second_to_square TEXT" },
        { name: "second_san", sql: "ALTER TABLE moves ADD COLUMN second_san TEXT" },
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
    })().catch((error: unknown) => {
        schemaPromise = undefined;
        throw error;
      });
  }
  return schemaPromise;
}
