CREATE TABLE `push_account_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`friend_request_id` text NOT NULL,
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
	CONSTRAINT "push_account_deliveries_kind_check" CHECK("push_account_deliveries"."kind" IN ('friend_request')),
	CONSTRAINT "push_account_deliveries_status_check" CHECK("push_account_deliveries"."status" IN ('pending', 'sent', 'failed', 'stale', 'dead', 'superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_account_deliveries_once_unique` ON `push_account_deliveries` (`device_id`,`friend_request_id`,`kind`);--> statement-breakpoint
CREATE INDEX `push_account_deliveries_created_idx` ON `push_account_deliveries` (`created_at`);--> statement-breakpoint
CREATE INDEX `push_account_deliveries_due_idx` ON `push_account_deliveries` (`status`,`next_attempt_at`,`lease_until`);