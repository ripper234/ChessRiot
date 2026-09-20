CREATE TABLE `feature_access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`feature_key` text NOT NULL,
	`requested_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feature_access_requests_account_feature_unique` ON `feature_access_requests` (`account_id`,`feature_key`);--> statement-breakpoint
CREATE INDEX `feature_access_requests_feature_time_idx` ON `feature_access_requests` (`feature_key`,`requested_at`);