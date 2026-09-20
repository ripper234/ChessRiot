CREATE TABLE `ops_action_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`subject_key` text,
	`used_at` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ops_action_nonces_scope_used_idx` ON `ops_action_nonces` (`scope`,`used_at`);--> statement-breakpoint
CREATE INDEX `ops_action_nonces_expiry_idx` ON `ops_action_nonces` (`expires_at`);--> statement-breakpoint
CREATE TABLE `push_devices` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_devices_endpoint_hash_unique` ON `push_devices` (`endpoint_hash`);--> statement-breakpoint
CREATE INDEX `push_devices_account_updated_idx` ON `push_devices` (`account_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `push_turn_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
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
	FOREIGN KEY (`device_id`) REFERENCES `push_devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_turn_deliveries_kind_check" CHECK("push_turn_deliveries"."kind" IN ('your_turn')),
	CONSTRAINT "push_turn_deliveries_status_check" CHECK("push_turn_deliveries"."status" IN ('pending', 'sent', 'failed', 'stale', 'dead', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_turn_deliveries_once_unique` ON `push_turn_deliveries` (`device_id`,`game_id`,`game_version`,`kind`);--> statement-breakpoint
CREATE INDEX `push_turn_deliveries_created_idx` ON `push_turn_deliveries` (`created_at`);--> statement-breakpoint
CREATE INDEX `push_turn_deliveries_due_idx` ON `push_turn_deliveries` (`status`,`next_attempt_at`,`lease_until`);