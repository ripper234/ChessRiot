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
    schemaPromise = db
      .batch([
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
          FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
          CHECK (
            (game_mode = 'solo' AND ai_difficulty IS NOT NULL) OR
            (game_mode = 'multiplayer' AND ai_difficulty IS NULL)
          )
        )`),
      ])
      .then(() => undefined)
      .catch((error: unknown) => {
        schemaPromise = undefined;
        throw error;
      });
  }
  return schemaPromise;
}
