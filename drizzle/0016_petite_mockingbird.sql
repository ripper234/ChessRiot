CREATE TABLE `account_blocks` (
	`blocker_account_id` text NOT NULL,
	`blocked_account_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`blocker_account_id`, `blocked_account_id`),
	FOREIGN KEY (`blocker_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`blocked_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_blocks_people_check" CHECK("account_blocks"."blocker_account_id" <> "account_blocks"."blocked_account_id")
);
--> statement-breakpoint
CREATE INDEX `account_blocks_blocked_idx` ON `account_blocks` (`blocked_account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `account_notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`recipient_account_id` text NOT NULL,
	`actor_account_id` text,
	`game_id` text,
	`kind` text NOT NULL,
	`source_key` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	FOREIGN KEY (`recipient_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_notifications_kind_check" CHECK("account_notifications"."kind" IN ('friend_request', 'challenge', 'turn', 'result'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_notifications_source_unique` ON `account_notifications` (`recipient_account_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `account_notifications_recipient_time_idx` ON `account_notifications` (`recipient_account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `account_tombstones` (
	`account_id` text PRIMARY KEY NOT NULL,
	`username_canonical` text NOT NULL,
	`deleted_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_tombstones_username_unique` ON `account_tombstones` (`username_canonical`);--> statement-breakpoint
CREATE TABLE `safety_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_account_id` text NOT NULL,
	`target_account_id` text NOT NULL,
	`category` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`reporter_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "safety_reports_people_check" CHECK("safety_reports"."reporter_account_id" <> "safety_reports"."target_account_id"),
	CONSTRAINT "safety_reports_category_check" CHECK("safety_reports"."category" IN ('spam', 'harassment', 'inappropriate_username', 'cheating', 'other')),
	CONSTRAINT "safety_reports_status_check" CHECK("safety_reports"."status" IN ('new', 'reviewed', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `safety_reports_status_time_idx` ON `safety_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `safety_reports_reporter_time_idx` ON `safety_reports` (`reporter_account_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `tutorial_status` text DEFAULT 'skipped' NOT NULL
  CHECK (`tutorial_status` IN ('pending', 'completed', 'skipped'));--> statement-breakpoint
ALTER TABLE `observability_events` ADD `actor_hash` text;
