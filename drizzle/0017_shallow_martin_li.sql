CREATE TABLE `public_rate_limit_windows` (
	`key` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`hit_count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_rate_limit_expiry_idx` ON `public_rate_limit_windows` (`expires_at`);--> statement-breakpoint
CREATE TABLE `safety_report_archive` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_username` text NOT NULL,
	`target_username` text NOT NULL,
	`category` text NOT NULL,
	`note` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text NOT NULL,
	`expires_at` text NOT NULL,
	CONSTRAINT "safety_report_archive_category_check" CHECK("safety_report_archive"."category" IN ('spam', 'harassment', 'inappropriate_username', 'cheating', 'other')),
	CONSTRAINT "safety_report_archive_status_check" CHECK("safety_report_archive"."status" IN ('new', 'reviewed', 'closed'))
);
--> statement-breakpoint
CREATE INDEX `safety_report_archive_status_time_idx` ON `safety_report_archive` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `safety_report_archive_expiry_idx` ON `safety_report_archive` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `observability_client_request_unique`
  ON `observability_events` (`request_id`)
  WHERE `event_name` IN (
    'client.error', 'client.unhandled_rejection', 'client.network_error',
    'public.home_viewed', 'demo.started', 'demo.completed', 'auth.started',
    'tutorial.started', 'tutorial.completed', 'tutorial.skipped', 'activity.opened'
  );
