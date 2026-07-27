CREATE TABLE `push_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`game_id` text NOT NULL,
	`game_version` integer NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`status_code` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `push_subscriptions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_deliveries_kind_check" CHECK("push_deliveries"."kind" IN ('your_turn')),
	CONSTRAINT "push_deliveries_status_check" CHECK("push_deliveries"."status" IN ('pending', 'sent', 'failed', 'stale'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_deliveries_once_unique` ON `push_deliveries` (`subscription_id`,`game_id`,`game_version`,`kind`);--> statement-breakpoint
CREATE INDEX `push_deliveries_created_idx` ON `push_deliveries` (`created_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`color` text NOT NULL,
	`account_id` text NOT NULL,
	`endpoint_hash` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`expiration_time` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_success_at` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`disabled_at` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_subscriptions_color_check" CHECK("push_subscriptions"."color" IN ('w', 'b'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_game_color_endpoint_unique` ON `push_subscriptions` (`game_id`,`color`,`endpoint_hash`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_game_color_updated_idx` ON `push_subscriptions` (`game_id`,`color`,`updated_at`);