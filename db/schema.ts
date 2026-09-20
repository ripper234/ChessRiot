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
    index("games_created_idx").on(table.createdAt),
    index("games_finished_idx").on(table.finishedAt),
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
    secondFromSquare: text("second_from_square"),
    secondToSquare: text("second_to_square"),
    secondSan: text("second_san"),
    continuationJson: text("continuation_json"),
    fenBefore: text("fen_before").notNull(),
    fenAfter: text("fen_after").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.ply] }),
    uniqueIndex("moves_request_unique").on(table.gameId, table.requestId),
    index("moves_created_idx").on(table.createdAt),
  ],
);

export const magicRuleCompilations = sqliteTable(
  "magic_rule_compilations",
  {
    cacheKey: text("cache_key").primaryKey().notNull(),
    compilerVersion: text("compiler_version").notNull(),
    status: text("status").notNull(),
    rulesJson: text("rules_json"),
    worldCode: text("world_code"),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("magic_rule_compilations_status_lease_idx")
      .on(table.status, table.leaseUntil),
    check(
      "magic_rule_compilations_status_check",
      sql`${table.status} IN ('pending', 'compiled', 'ready')`,
    ),
    check(
      "magic_rule_compilations_state_check",
      sql`(
        (${table.status} = 'ready' AND ${table.rulesJson} IS NOT NULL
          AND ${table.worldCode} IS NOT NULL
          AND ${table.leaseToken} IS NULL AND ${table.leaseUntil} IS NULL) OR
        (${table.status} = 'compiled' AND ${table.rulesJson} IS NOT NULL
          AND ${table.worldCode} IS NULL
          AND ${table.leaseToken} IS NULL AND ${table.leaseUntil} IS NULL) OR
        (${table.status} = 'pending' AND ${table.rulesJson} IS NULL
          AND ${table.worldCode} IS NULL
          AND ${table.leaseToken} IS NOT NULL AND ${table.leaseUntil} IS NOT NULL)
      )`,
    ),
  ],
);

export const magicRuleRejections = sqliteTable(
  "magic_rule_rejections",
  {
    cacheKey: text("cache_key").primaryKey().notNull(),
    compilerVersion: text("compiler_version").notNull(),
    code: text("code").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "magic_rule_rejections_code_check",
      sql`${table.code} IN ('unsupported', 'ambiguous')`,
    ),
  ],
);

export const gameSettings = sqliteTable(
  "game_settings",
  {
    gameId: text("game_id")
      .primaryKey()
      .references(() => games.id, { onDelete: "cascade" }),
    gameMode: text("game_mode").notNull().default("multiplayer"),
    variantId: text("variant_id").notNull().default("standard"),
    aiDifficulty: integer("ai_difficulty"),
    humanColor: text("human_color").notNull().default("w"),
    turnPaceDays: integer("turn_pace_days"),
    magicPrompt: text("magic_prompt"),
    magicRulesJson: text("magic_rules_json"),
    worldCode: text("world_code"),
  },
  (table) => [
    index("game_settings_world_idx").on(table.worldCode),
    check(
      "game_settings_game_mode_check",
      sql`${table.gameMode} IN ('solo', 'multiplayer')`,
    ),
    check(
      "game_settings_variant_id_check",
      sql`${table.variantId} IN (
        'standard',
        'pawn-riot',
        'half-army',
        'pawn-duel',
        'mate-pawn',
        'mate-rook',
        'mate-two-bishops'
      )`,
    ),
    check(
      "game_settings_ai_difficulty_check",
      sql`${table.aiDifficulty} IS NULL OR ${table.aiDifficulty} BETWEEN 1 AND 5`,
    ),
    check(
      "game_settings_human_color_check",
      sql`${table.humanColor} IN ('w', 'b')`,
    ),
    check(
      "game_settings_turn_pace_days_check",
      sql`${table.turnPaceDays} IS NULL OR ${table.turnPaceDays} IN (1, 3, 5)`,
    ),
    check(
      "game_settings_mode_difficulty_check",
      sql`(
        (${table.gameMode} = 'solo' AND ${table.aiDifficulty} IS NOT NULL) OR
        (${table.gameMode} = 'multiplayer' AND ${table.aiDifficulty} IS NULL)
      )`,
    ),
  ],
);

export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey().notNull(),
  displayName: text("display_name").notNull(),
  username: text("username"),
  usernameCanonical: text("username_canonical"),
  usernameSetAt: text("username_set_at"),
  tutorialStatus: text("tutorial_status").notNull().default("skipped"),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  lastCaptchaAt: text("last_captcha_at").notNull(),
}, (table) => [
  uniqueIndex("accounts_username_canonical_unique").on(table.usernameCanonical),
  index("accounts_created_idx").on(table.createdAt),
  check(
    "accounts_tutorial_status_check",
    sql`${table.tutorialStatus} IN ('pending', 'completed', 'skipped')`,
  ),
]);

export const accountTombstones = sqliteTable(
  "account_tombstones",
  {
    accountId: text("account_id").primaryKey().notNull(),
    usernameCanonical: text("username_canonical").notNull(),
    deletedAt: text("deleted_at").notNull(),
  },
  (table) => [
    uniqueIndex("account_tombstones_username_unique").on(table.usernameCanonical),
  ],
);

export const friendRequests = sqliteTable(
  "friend_requests",
  {
    id: text("id").primaryKey().notNull(),
    pairKey: text("pair_key").notNull(),
    senderAccountId: text("sender_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    recipientAccountId: text("recipient_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull(),
    respondedAt: text("responded_at"),
  },
  (table) => [
    uniqueIndex("friend_requests_pair_unique").on(table.pairKey),
    index("friend_requests_sender_status_idx").on(table.senderAccountId, table.status),
    index("friend_requests_recipient_status_idx").on(table.recipientAccountId, table.status),
    index("friend_requests_created_idx").on(table.createdAt),
    check(
      "friend_requests_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'declined')`,
    ),
    check(
      "friend_requests_people_check",
      sql`${table.senderAccountId} <> ${table.recipientAccountId}`,
    ),
  ],
);

export const accountBlocks = sqliteTable(
  "account_blocks",
  {
    blockerAccountId: text("blocker_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    blockedAccountId: text("blocked_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.blockerAccountId, table.blockedAccountId] }),
    index("account_blocks_blocked_idx").on(table.blockedAccountId, table.createdAt),
    check(
      "account_blocks_people_check",
      sql`${table.blockerAccountId} <> ${table.blockedAccountId}`,
    ),
  ],
);

export const accountNotifications = sqliteTable(
  "account_notifications",
  {
    id: text("id").primaryKey().notNull(),
    recipientAccountId: text("recipient_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    actorAccountId: text("actor_account_id")
      .references(() => accounts.id, { onDelete: "set null" }),
    gameId: text("game_id")
      .references(() => games.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    sourceKey: text("source_key").notNull(),
    createdAt: text("created_at").notNull(),
    readAt: text("read_at"),
  },
  (table) => [
    uniqueIndex("account_notifications_source_unique")
      .on(table.recipientAccountId, table.sourceKey),
    index("account_notifications_recipient_time_idx")
      .on(table.recipientAccountId, table.createdAt),
    check(
      "account_notifications_kind_check",
      sql`${table.kind} IN ('friend_request', 'challenge', 'turn', 'result')`,
    ),
  ],
);

export const safetyReports = sqliteTable(
  "safety_reports",
  {
    id: text("id").primaryKey().notNull(),
    reporterAccountId: text("reporter_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    targetAccountId: text("target_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    note: text("note"),
    status: text("status").notNull().default("new"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("safety_reports_status_time_idx").on(table.status, table.createdAt),
    index("safety_reports_reporter_time_idx").on(table.reporterAccountId, table.createdAt),
    check(
      "safety_reports_people_check",
      sql`${table.reporterAccountId} <> ${table.targetAccountId}`,
    ),
    check(
      "safety_reports_category_check",
      sql`${table.category} IN ('spam', 'harassment', 'inappropriate_username', 'cheating', 'other')`,
    ),
    check(
      "safety_reports_status_check",
      sql`${table.status} IN ('new', 'reviewed', 'closed')`,
    ),
  ],
);

export const safetyReportArchive = sqliteTable(
  "safety_report_archive",
  {
    id: text("id").primaryKey().notNull(),
    reporterUsername: text("reporter_username").notNull(),
    targetUsername: text("target_username").notNull(),
    category: text("category").notNull(),
    note: text("note"),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    archivedAt: text("archived_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    index("safety_report_archive_status_time_idx").on(table.status, table.createdAt),
    index("safety_report_archive_expiry_idx").on(table.expiresAt),
    check(
      "safety_report_archive_category_check",
      sql`${table.category} IN ('spam', 'harassment', 'inappropriate_username', 'cheating', 'other')`,
    ),
    check(
      "safety_report_archive_status_check",
      sql`${table.status} IN ('new', 'reviewed', 'closed')`,
    ),
  ],
);

export const publicRateLimitWindows = sqliteTable(
  "public_rate_limit_windows",
  {
    key: text("key").primaryKey().notNull(),
    scope: text("scope").notNull(),
    hitCount: integer("hit_count").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("public_rate_limit_expiry_idx").on(table.expiresAt)],
);

export const referralLinks = sqliteTable(
  "referral_links",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("referral_links_code_unique").on(table.code),
    check(
      "referral_links_code_check",
      sql`length(${table.code}) = 16 AND ${table.code} NOT GLOB '*[^A-Za-z0-9_-]*'`,
    ),
  ],
);

export const referralAttributions = sqliteTable(
  "referral_attributions",
  {
    referredAccountId: text("referred_account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    referrerAccountId: text("referrer_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    referralCode: text("referral_code")
      .notNull()
      .references(() => referralLinks.code, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    credits: integer("credits").notNull().default(0),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("referral_attributions_referrer_status_idx")
      .on(table.referrerAccountId, table.status, table.createdAt),
    index("referral_attributions_status_completed_idx")
      .on(table.status, table.completedAt),
    check(
      "referral_attributions_status_check",
      sql`${table.status} IN ('pending', 'rewarded')`,
    ),
    check(
      "referral_attributions_people_check",
      sql`${table.referrerAccountId} <> ${table.referredAccountId}`,
    ),
    check(
      "referral_attributions_credits_check",
      sql`(
        (${table.status} = 'pending' AND ${table.credits} = 0 AND ${table.completedAt} IS NULL) OR
        (${table.status} = 'rewarded' AND ${table.credits} > 0 AND ${table.completedAt} IS NOT NULL)
      )`,
    ),
  ],
);

export const accountCreditLedger = sqliteTable(
  "account_credit_ledger",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    sourceKey: text("source_key").notNull(),
    worldCode: text("world_code"),
    gameId: text("game_id")
      .references(() => games.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("account_credit_ledger_source_unique").on(table.sourceKey),
    index("account_credit_ledger_account_time_idx").on(table.accountId, table.createdAt),
    index("account_credit_ledger_world_time_idx").on(table.worldCode, table.createdAt),
    check("account_credit_ledger_amount_check", sql`${table.amount} <> 0`),
    check(
      "account_credit_ledger_reason_check",
      sql`${table.reason} IN ('starter', 'referral', 'magic_spend', 'magic_refund', 'world_royalty')`,
    ),
  ],
);

export const magicWorlds = sqliteTable(
  "magic_worlds",
  {
    code: text("code").primaryKey().notNull(),
    fullHash: text("full_hash").notNull(),
    canonicalCode: text("canonical_code").notNull(),
    rulesJson: text("rules_json").notNull(),
    creatorAccountId: text("creator_account_id")
      .references(() => accounts.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("magic_worlds_full_hash_unique").on(table.fullHash),
    uniqueIndex("magic_worlds_canonical_unique").on(table.canonicalCode),
    index("magic_worlds_creator_time_idx").on(table.creatorAccountId, table.createdAt),
  ],
);

export const magicWorldSources = sqliteTable(
  "magic_world_sources",
  {
    sourceKey: text("source_key").primaryKey().notNull(),
    worldCode: text("world_code")
      .notNull()
      .references(() => magicWorlds.code, { onDelete: "cascade" }),
    contributorAccountId: text("contributor_account_id")
      .references(() => accounts.id, { onDelete: "set null" }),
    promptHash: text("prompt_hash"),
    compilerVersion: text("compiler_version").notNull(),
    parentCode: text("parent_code"),
    kind: text("kind").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("magic_world_sources_world_time_idx").on(table.worldCode, table.createdAt),
    index("magic_world_sources_contributor_time_idx")
      .on(table.contributorAccountId, table.createdAt),
    check(
      "magic_world_sources_kind_check",
      sql`${table.kind} IN ('create', 'rediscover', 'fork', 'play')`,
    ),
  ],
);

export const magicWorldDerivations = sqliteTable(
  "magic_world_derivations",
  {
    parentCode: text("parent_code")
      .notNull()
      .references(() => magicWorlds.code, { onDelete: "cascade" }),
    childCode: text("child_code")
      .notNull()
      .references(() => magicWorlds.code, { onDelete: "cascade" }),
    createdByAccountId: text("created_by_account_id")
      .references(() => accounts.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.parentCode, table.childCode] }),
    index("magic_world_derivations_child_idx").on(table.childCode, table.createdAt),
    check("magic_world_derivations_distinct_check", sql`${table.parentCode} <> ${table.childCode}`),
  ],
);

export const magicWorldEntitlements = sqliteTable(
  "magic_world_entitlements",
  {
    gameCreateRequestId: text("game_create_request_id").primaryKey().notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    worldCode: text("world_code")
      .notNull()
      .references(() => magicWorlds.code, { onDelete: "cascade" }),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: text("created_at").notNull(),
    consumedAt: text("consumed_at"),
    gameId: text("game_id")
      .references(() => games.id, { onDelete: "set null" }),
  },
  (table) => [
    index("magic_world_entitlements_account_time_idx").on(table.accountId, table.createdAt),
    index("magic_world_entitlements_world_time_idx").on(table.worldCode, table.createdAt),
  ],
);

export const magicWorldUses = sqliteTable(
  "magic_world_uses",
  {
    gameId: text("game_id")
      .primaryKey()
      .references(() => games.id, { onDelete: "cascade" }),
    worldCode: text("world_code")
      .notNull()
      .references(() => magicWorlds.code, { onDelete: "cascade" }),
    spenderAccountId: text("spender_account_id")
      .references(() => accounts.id, { onDelete: "set null" }),
    creatorAccountId: text("creator_account_id")
      .references(() => accounts.id, { onDelete: "set null" }),
    qualifiesForRoyalty: integer("qualifies_for_royalty", { mode: "boolean" })
      .notNull()
      .default(false),
    humanPlayedAt: text("human_played_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("magic_world_uses_world_time_idx").on(table.worldCode, table.createdAt),
    index("magic_world_uses_creator_qualifies_idx")
      .on(table.creatorAccountId, table.qualifiesForRoyalty, table.createdAt),
    check(
      "magic_world_uses_qualifies_check",
      sql`${table.qualifiesForRoyalty} IN (0, 1)`,
    ),
  ],
);

export const accountFeatureFlags = sqliteTable(
  "account_feature_flags",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    featureKey: text("feature_key").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.featureKey] }),
    index("account_feature_flags_feature_idx").on(table.featureKey, table.enabled),
  ],
);

export const featureAccessRequests = sqliteTable(
  "feature_access_requests",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    featureKey: text("feature_key").notNull(),
    requestedAt: text("requested_at").notNull(),
  },
  (table) => [
    uniqueIndex("feature_access_requests_account_feature_unique")
      .on(table.accountId, table.featureKey),
    index("feature_access_requests_feature_time_idx")
      .on(table.featureKey, table.requestedAt),
  ],
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey().notNull(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    color: text("color").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    endpointHash: text("endpoint_hash").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    expirationTime: integer("expiration_time"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastSuccessAt: text("last_success_at"),
    failureCount: integer("failure_count").notNull().default(0),
    disabledAt: text("disabled_at"),
  },
  (table) => [
    uniqueIndex("push_subscriptions_game_color_endpoint_unique")
      .on(table.gameId, table.color, table.endpointHash),
    index("push_subscriptions_game_color_updated_idx")
      .on(table.gameId, table.color, table.updatedAt),
    check("push_subscriptions_color_check", sql`${table.color} IN ('w', 'b')`),
  ],
);

export const pushDevices = sqliteTable(
  "push_devices",
  {
    id: text("id").primaryKey().notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    endpointHash: text("endpoint_hash").notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    expirationTime: integer("expiration_time"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    lastSuccessAt: text("last_success_at"),
    failureCount: integer("failure_count").notNull().default(0),
    disabledAt: text("disabled_at"),
  },
  (table) => [
    uniqueIndex("push_devices_endpoint_hash_unique").on(table.endpointHash),
    index("push_devices_account_updated_idx").on(table.accountId, table.updatedAt),
  ],
);

export const pushTurnDeliveries = sqliteTable(
  "push_turn_deliveries",
  {
    id: text("id").primaryKey().notNull(),
    deviceId: text("device_id")
      .notNull()
      .references(() => pushDevices.id, { onDelete: "cascade" }),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    gameVersion: integer("game_version").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    statusCode: integer("status_code"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("push_turn_deliveries_once_unique")
      .on(table.deviceId, table.gameId, table.gameVersion, table.kind),
    index("push_turn_deliveries_created_idx").on(table.createdAt),
    index("push_turn_deliveries_due_idx")
      .on(table.status, table.nextAttemptAt, table.leaseUntil),
    check(
      "push_turn_deliveries_kind_check",
      sql`${table.kind} IN ('your_turn')`,
    ),
    check(
      "push_turn_deliveries_status_check",
      sql`${table.status} IN ('pending', 'sent', 'failed', 'stale', 'dead', 'superseded')`,
    ),
  ],
);

export const pushAccountDeliveries = sqliteTable(
  "push_account_deliveries",
  {
    id: text("id").primaryKey().notNull(),
    deviceId: text("device_id")
      .notNull()
      .references(() => pushDevices.id, { onDelete: "cascade" }),
    friendRequestId: text("friend_request_id")
      .notNull()
      .references(() => friendRequests.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    statusCode: integer("status_code"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("push_account_deliveries_once_unique")
      .on(table.deviceId, table.friendRequestId, table.kind),
    index("push_account_deliveries_created_idx").on(table.createdAt),
    index("push_account_deliveries_due_idx")
      .on(table.status, table.nextAttemptAt, table.leaseUntil),
    check(
      "push_account_deliveries_kind_check",
      sql`${table.kind} IN ('friend_request')`,
    ),
    check(
      "push_account_deliveries_status_check",
      sql`${table.status} IN ('pending', 'sent', 'failed', 'stale', 'dead', 'superseded')`,
    ),
  ],
);

export const pushDeliveries = sqliteTable(
  "push_deliveries",
  {
    id: text("id").primaryKey().notNull(),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    gameVersion: integer("game_version").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    statusCode: integer("status_code"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at").notNull().default(0),
    leaseToken: text("lease_token"),
    leaseUntil: integer("lease_until"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("push_deliveries_once_unique")
      .on(table.subscriptionId, table.gameId, table.gameVersion, table.kind),
    index("push_deliveries_created_idx").on(table.createdAt),
    index("push_deliveries_due_idx")
      .on(table.status, table.nextAttemptAt, table.leaseUntil),
    check(
      "push_deliveries_kind_check",
      sql`${table.kind} IN ('your_turn')`,
    ),
    check(
      "push_deliveries_status_check",
      sql`${table.status} IN ('pending', 'sent', 'failed', 'stale', 'dead', 'superseded')`,
    ),
  ],
);

export const gameMemberships = sqliteTable(
  "game_memberships",
  {
    gameId: text("game_id").notNull(),
    color: text("color").notNull(),
    accountId: text("account_id").notNull(),
    claimedAt: text("claimed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.color] }),
    uniqueIndex("game_memberships_game_account_unique")
      .on(table.gameId, table.accountId),
    index("game_memberships_account_idx").on(table.accountId, table.claimedAt),
    check("game_memberships_color_check", sql`${table.color} IN ('w', 'b')`),
  ],
);

export const gameRecapShares = sqliteTable(
  "game_recap_shares",
  {
    id: text("id").primaryKey().notNull(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("game_recap_shares_game_unique").on(table.gameId),
  ],
);

export const rateLimitWindows = sqliteTable(
  "rate_limit_windows",
  {
    key: text("key").primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    scope: text("scope").notNull(),
    windowStart: integer("window_start").notNull(),
    hitCount: integer("hit_count").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("rate_limit_expiry_idx").on(table.expiresAt),
  ],
);

export const botTurnLeases = sqliteTable("bot_turn_leases", {
  gameId: text("game_id").primaryKey().notNull(),
  gameVersion: integer("game_version").notNull(),
  nonce: text("nonce").notNull(),
  leaseUntil: text("lease_until").notNull(),
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

export const gameReactions = sqliteTable(
  "game_reactions",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    id: text("id").notNull(),
    gameId: text("game_id").notNull(),
    requestId: text("request_id").notNull(),
    senderColor: text("sender_color").notNull(),
    reactionKey: text("reaction_key").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("game_reactions_id_unique").on(table.id),
    uniqueIndex("game_reactions_request_unique").on(table.gameId, table.requestId),
    index("game_reactions_game_sequence_idx").on(table.gameId, table.sequence),
    check("game_reactions_color_check", sql`${table.senderColor} IN ('w', 'b')`),
    check(
      "game_reactions_key_check",
      sql`${table.reactionKey} IN ('hi', 'good_luck', 'nice_move', 'well_played', 'good_game', 'thanks')`,
    ),
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
    actorHash: text("actor_hash"),
    route: text("route"),
    method: text("method"),
    statusCode: integer("status_code"),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms"),
    metadataJson: text("metadata_json"),
  },
  (table) => [
    uniqueIndex("observability_events_id_unique").on(table.id),
    index("observability_actor_time_idx").on(table.actorHash, table.occurredAt),
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

export const demoVideoJobs = sqliteTable(
  "demo_video_jobs",
  {
    id: text("id").primaryKey().notNull(),
    status: text("status").notNull(),
    requestedAt: text("requested_at").notNull(),
    narrationReadyAt: text("narration_ready_at"),
    publishedAt: text("published_at"),
    durationSeconds: integer("duration_seconds"),
    sizeBytes: integer("size_bytes"),
    mediaKey: text("media_key"),
    errorCode: text("error_code"),
  },
  (table) => [
    index("demo_video_jobs_requested_idx").on(table.requestedAt),
    check(
      "demo_video_jobs_status_check",
      sql`${table.status} IN ('narrating', 'rendering', 'publishing', 'ready', 'failed')`,
    ),
  ],
);

export const demoVideoGenerationLock = sqliteTable(
  "demo_video_generation_lock",
  {
    id: integer("id").primaryKey().notNull(),
    jobId: text("job_id").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    check("demo_video_generation_lock_id_check", sql`${table.id} = 1`),
  ],
);

export const demoVideoNonces = sqliteTable(
  "demo_video_nonces",
  {
    nonce: text("nonce").primaryKey().notNull(),
    usedAt: text("used_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [
    index("demo_video_nonces_expiry_idx").on(table.expiresAt),
  ],
);

export const opsActionNonces = sqliteTable(
  "ops_action_nonces",
  {
    nonce: text("nonce").primaryKey().notNull(),
    scope: text("scope").notNull(),
    subjectKey: text("subject_key"),
    usedAt: text("used_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    resultJson: text("result_json"),
  },
  (table) => [
    index("ops_action_nonces_scope_used_idx").on(table.scope, table.usedAt),
    index("ops_action_nonces_expiry_idx").on(table.expiresAt),
  ],
);

export const runtimeInvariants = sqliteTable(
  "runtime_invariants",
  {
    id: integer("id").primaryKey().notNull(),
    storageEpoch: text("storage_epoch").notNull().unique(),
    environment: text("environment").notNull(),
    accountIdentityMarker: text("account_identity_marker").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("runtime_invariants_singleton_check", sql`${table.id} = 1`),
  ],
);
