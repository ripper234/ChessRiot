PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_push_account_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`friend_request_id` text,
	`game_id` text,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`status_code` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `push_devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`friend_request_id`) REFERENCES `friend_requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_account_deliveries_kind_check" CHECK(("__new_push_account_deliveries"."kind" = 'friend_request' AND "__new_push_account_deliveries"."friend_request_id" IS NOT NULL AND "__new_push_account_deliveries"."game_id" IS NULL) OR ("__new_push_account_deliveries"."kind" = 'challenge' AND "__new_push_account_deliveries"."game_id" IS NOT NULL AND "__new_push_account_deliveries"."friend_request_id" IS NULL)),
	CONSTRAINT "push_account_deliveries_status_check" CHECK("__new_push_account_deliveries"."status" IN ('pending', 'sent', 'failed', 'stale', 'dead', 'superseded'))
);
--> statement-breakpoint
INSERT INTO `__new_push_account_deliveries`("id", "device_id", "friend_request_id", "game_id", "kind", "status", "status_code", "attempt_count", "next_attempt_at", "lease_token", "lease_until", "created_at", "updated_at") SELECT "id", "device_id", "friend_request_id", NULL, "kind", "status", "status_code", "attempt_count", "next_attempt_at", "lease_token", "lease_until", "created_at", "updated_at" FROM `push_account_deliveries`;--> statement-breakpoint
DROP TABLE `push_account_deliveries`;--> statement-breakpoint
ALTER TABLE `__new_push_account_deliveries` RENAME TO `push_account_deliveries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `push_account_deliveries_once_unique` ON `push_account_deliveries` (`device_id`,`friend_request_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `push_account_deliveries_challenge_unique` ON `push_account_deliveries` (`device_id`,`game_id`,`kind`);--> statement-breakpoint
CREATE INDEX `push_account_deliveries_created_idx` ON `push_account_deliveries` (`created_at`);--> statement-breakpoint
CREATE INDEX `push_account_deliveries_due_idx` ON `push_account_deliveries` (`status`,`next_attempt_at`,`lease_until`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `locale` text DEFAULT 'en' NOT NULL;