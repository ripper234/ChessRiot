import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
});
