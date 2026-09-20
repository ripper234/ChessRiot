CREATE TABLE `account_feature_flags` (
	`account_id` text NOT NULL,
	`feature_key` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`account_id`, `feature_key`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_feature_flags_feature_idx` ON `account_feature_flags` (`feature_key`,`enabled`);--> statement-breakpoint
CREATE TABLE `friend_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`pair_key` text NOT NULL,
	`sender_account_id` text NOT NULL,
	`recipient_account_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`responded_at` text,
	FOREIGN KEY (`sender_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "friend_requests_status_check" CHECK("friend_requests"."status" IN ('pending', 'accepted', 'declined')),
	CONSTRAINT "friend_requests_people_check" CHECK("friend_requests"."sender_account_id" <> "friend_requests"."recipient_account_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_requests_pair_unique` ON `friend_requests` (`pair_key`);--> statement-breakpoint
CREATE INDEX `friend_requests_sender_status_idx` ON `friend_requests` (`sender_account_id`,`status`);--> statement-breakpoint
CREATE INDEX `friend_requests_recipient_status_idx` ON `friend_requests` (`recipient_account_id`,`status`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `username` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `username_canonical` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `username_set_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_username_canonical_unique` ON `accounts` (`username_canonical`);