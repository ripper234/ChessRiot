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
          ai_difficulty INTEGER
            CHECK (ai_difficulty IS NULL OR ai_difficulty BETWEEN 1 AND 5),
          human_color TEXT NOT NULL DEFAULT 'w'
            CHECK (human_color IN ('w', 'b')),
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
          CHECK (
            (game_mode = 'solo' AND ai_difficulty IS NOT NULL) OR
            (game_mode = 'multiplayer' AND ai_difficulty IS NULL)
          )
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
    })().catch((error: unknown) => {
        schemaPromise = undefined;
        throw error;
      });
  }
  return schemaPromise;
}
