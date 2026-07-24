import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const games = sqliteTable(
  "games",
  {
    id: text("id").primaryKey(),
    createRequestId: text("create_request_id").notNull(),
    status: text("status").notNull(),
    whiteName: text("white_name").notNull(),
    blackName: text("black_name"),
    whiteTokenHash: text("white_token_hash").notNull(),
    blackTokenHash: text("black_token_hash"),
    inviteTokenHash: text("invite_token_hash").notNull(),
    initialFen: text("initial_fen").notNull(),
    currentFen: text("current_fen").notNull(),
    turnColor: text("turn_color").notNull(),
    version: integer("version").notNull().default(0),
    plyCount: integer("ply_count").notNull().default(0),
    winnerColor: text("winner_color"),
    termination: text("termination"),
    lastMutationNonce: text("last_mutation_nonce"),
    createdAt: text("created_at").notNull(),
    joinedAt: text("joined_at"),
    updatedAt: text("updated_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (table) => [
    uniqueIndex("games_create_request_unique").on(table.createRequestId),
    uniqueIndex("games_invite_token_unique").on(table.inviteTokenHash),
  ],
);

export const moves = sqliteTable(
  "moves",
  {
    gameId: text("game_id").notNull(),
    ply: integer("ply").notNull(),
    requestId: text("request_id").notNull(),
    color: text("color").notNull(),
    fromSquare: text("from_square").notNull(),
    toSquare: text("to_square").notNull(),
    promotion: text("promotion"),
    san: text("san").notNull(),
    fenBefore: text("fen_before").notNull(),
    fenAfter: text("fen_after").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.ply] }),
    uniqueIndex("moves_request_unique").on(table.gameId, table.requestId),
  ],
);

export const gameSettings = sqliteTable("game_settings", {
  gameId: text("game_id").primaryKey(),
  gameMode: text("game_mode").notNull().default("multiplayer"),
  aiDifficulty: integer("ai_difficulty"),
  humanColor: text("human_color").notNull().default("w"),
});

export const gameActions = sqliteTable(
  "game_actions",
  {
    gameId: text("game_id").notNull(),
    requestId: text("request_id").notNull(),
    actionType: text("action_type").notNull(),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.requestId] }),
  ],
);

export const observabilityEvents = sqliteTable(
  "observability_events",
  {
    id: text("id").primaryKey(),
    occurredAt: text("occurred_at").notNull(),
    environment: text("environment").notNull(),
    appVersion: text("app_version").notNull(),
    eventName: text("event_name").notNull(),
    outcome: text("outcome").notNull(),
    requestId: text("request_id"),
    subjectHash: text("subject_hash"),
    route: text("route"),
    method: text("method"),
    statusCode: integer("status_code"),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms"),
    metadataJson: text("metadata_json"),
  },
  (table) => [
    uniqueIndex("observability_events_id_unique").on(table.id),
  ],
);

export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    title: text("title").notNull(),
    comment: text("comment"),
    page: text("page").notNull(),
    environment: text("environment").notNull(),
    appVersion: text("app_version").notNull(),
    status: text("status").notNull().default("new"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("feedback_request_unique").on(table.requestId),
    index("feedback_created_idx").on(table.createdAt),
    check("feedback_status_check", sql`${table.status} IN ('new', 'reviewed', 'closed')`),
  ],
);
