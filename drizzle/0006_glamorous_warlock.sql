CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`last_captcha_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bot_turn_leases` (
	`game_id` text PRIMARY KEY NOT NULL,
	`game_version` integer NOT NULL,
	`nonce` text NOT NULL,
	`lease_until` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_memberships` (
	`game_id` text NOT NULL,
	`color` text NOT NULL,
	`account_id` text NOT NULL,
	`claimed_at` text NOT NULL,
	PRIMARY KEY(`game_id`, `color`),
	CONSTRAINT "game_memberships_color_check" CHECK("game_memberships"."color" IN ('w', 'b'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_memberships_game_account_unique` ON `game_memberships` (`game_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `game_memberships_account_idx` ON `game_memberships` (`account_id`,`claimed_at`);--> statement-breakpoint
CREATE TABLE `rate_limit_windows` (
	`key` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`scope` text NOT NULL,
	`window_start` integer NOT NULL,
	`hit_count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_limit_expiry_idx` ON `rate_limit_windows` (`expires_at`);