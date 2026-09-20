PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_push_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`game_id` text NOT NULL,
	`game_version` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`status_code` integer,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT 0 NOT NULL,
	`lease_token` text,
	`lease_until` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_deliveries_kind_check" CHECK("__new_push_deliveries"."kind" IN ('your_turn')),
	CONSTRAINT "push_deliveries_status_check" CHECK("__new_push_deliveries"."status" IN ('pending', 'sent', 'failed', 'stale', 'dead', 'superseded'))
);
--> statement-breakpoint
INSERT INTO `__new_push_deliveries`("id", "subscription_id", "game_id", "game_version", "kind", "status", "status_code", "attempt_count", "next_attempt_at", "lease_token", "lease_until", "created_at", "updated_at") SELECT "id", "subscription_id", "game_id", "game_version", "kind", "status", "status_code", 0, 0, NULL, NULL, "created_at", "updated_at" FROM `push_deliveries`;--> statement-breakpoint
DROP TABLE `push_deliveries`;--> statement-breakpoint
ALTER TABLE `__new_push_deliveries` RENAME TO `push_deliveries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `push_deliveries_once_unique` ON `push_deliveries` (`subscription_id`,`game_id`,`game_version`,`kind`);--> statement-breakpoint
CREATE INDEX `push_deliveries_created_idx` ON `push_deliveries` (`created_at`);--> statement-breakpoint
CREATE INDEX `push_deliveries_due_idx` ON `push_deliveries` (`status`,`next_attempt_at`,`lease_until`);
