CREATE TABLE `account_credit_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`source_key` text NOT NULL,
	`world_code` text,
	`game_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "account_credit_ledger_amount_check" CHECK("account_credit_ledger"."amount" <> 0),
	CONSTRAINT "account_credit_ledger_reason_check" CHECK("account_credit_ledger"."reason" IN ('starter', 'referral', 'magic_spend', 'magic_refund', 'world_royalty'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_credit_ledger_source_unique` ON `account_credit_ledger` (`source_key`);--> statement-breakpoint
CREATE INDEX `account_credit_ledger_account_time_idx` ON `account_credit_ledger` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `account_credit_ledger_world_time_idx` ON `account_credit_ledger` (`world_code`,`created_at`);--> statement-breakpoint
CREATE TABLE `magic_world_derivations` (
	`parent_code` text NOT NULL,
	`child_code` text NOT NULL,
	`created_by_account_id` text,
	`created_at` text NOT NULL,
	PRIMARY KEY(`parent_code`, `child_code`),
	FOREIGN KEY (`parent_code`) REFERENCES `magic_worlds`(`code`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`child_code`) REFERENCES `magic_worlds`(`code`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "magic_world_derivations_distinct_check" CHECK("magic_world_derivations"."parent_code" <> "magic_world_derivations"."child_code")
);
--> statement-breakpoint
CREATE INDEX `magic_world_derivations_child_idx` ON `magic_world_derivations` (`child_code`,`created_at`);--> statement-breakpoint
CREATE TABLE `magic_world_entitlements` (
	`game_create_request_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`world_code` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	`consumed_at` text,
	`game_id` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`world_code`) REFERENCES `magic_worlds`(`code`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `magic_world_entitlements_account_time_idx` ON `magic_world_entitlements` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `magic_world_entitlements_world_time_idx` ON `magic_world_entitlements` (`world_code`,`created_at`);--> statement-breakpoint
CREATE TABLE `magic_world_sources` (
	`source_key` text PRIMARY KEY NOT NULL,
	`world_code` text NOT NULL,
	`contributor_account_id` text,
	`prompt_hash` text,
	`compiler_version` text NOT NULL,
	`parent_code` text,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`world_code`) REFERENCES `magic_worlds`(`code`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contributor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "magic_world_sources_kind_check" CHECK("magic_world_sources"."kind" IN ('create', 'rediscover', 'fork', 'play'))
);
--> statement-breakpoint
CREATE INDEX `magic_world_sources_world_time_idx` ON `magic_world_sources` (`world_code`,`created_at`);--> statement-breakpoint
CREATE INDEX `magic_world_sources_contributor_time_idx` ON `magic_world_sources` (`contributor_account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `magic_world_uses` (
	`game_id` text PRIMARY KEY NOT NULL,
	`world_code` text NOT NULL,
	`spender_account_id` text,
	`creator_account_id` text,
	`qualifies_for_royalty` integer DEFAULT false NOT NULL,
	`human_played_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`world_code`) REFERENCES `magic_worlds`(`code`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`spender_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`creator_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "magic_world_uses_qualifies_check" CHECK("magic_world_uses"."qualifies_for_royalty" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `magic_world_uses_world_time_idx` ON `magic_world_uses` (`world_code`,`created_at`);--> statement-breakpoint
CREATE INDEX `magic_world_uses_creator_qualifies_idx` ON `magic_world_uses` (`creator_account_id`,`qualifies_for_royalty`,`created_at`);--> statement-breakpoint
CREATE TABLE `magic_worlds` (
	`code` text PRIMARY KEY NOT NULL,
	`full_hash` text NOT NULL,
	`canonical_code` text NOT NULL,
	`rules_json` text NOT NULL,
	`creator_account_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`creator_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `magic_worlds_full_hash_unique` ON `magic_worlds` (`full_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `magic_worlds_canonical_unique` ON `magic_worlds` (`canonical_code`);--> statement-breakpoint
CREATE INDEX `magic_worlds_creator_time_idx` ON `magic_worlds` (`creator_account_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `game_settings` ADD `world_code` text;--> statement-breakpoint
CREATE INDEX `game_settings_world_idx` ON `game_settings` (`world_code`);--> statement-breakpoint
ALTER TABLE `magic_rule_compilations` ADD `world_code` text;--> statement-breakpoint
UPDATE `referral_attributions`
SET `credits` = 10
WHERE `status` = 'rewarded' AND `credits` <> 10;--> statement-breakpoint
INSERT OR IGNORE INTO `account_credit_ledger` (
	`id`, `account_id`, `amount`, `reason`, `source_key`, `created_at`
)
SELECT
	'starter:' || `id`, `id`, 10, 'starter', 'starter:' || `id`, `created_at`
FROM `accounts`;--> statement-breakpoint
INSERT OR IGNORE INTO `account_credit_ledger` (
	`id`, `account_id`, `amount`, `reason`, `source_key`, `created_at`
)
SELECT
	'referral:' || `referred_account_id`, `referrer_account_id`, 10,
	'referral', 'referral:' || `referred_account_id`,
	COALESCE(`completed_at`, `created_at`)
FROM `referral_attributions`
WHERE `status` = 'rewarded';
