CREATE TABLE `feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`title` text NOT NULL,
	`comment` text,
	`page` text NOT NULL,
	`environment` text NOT NULL,
	`app_version` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "feedback_status_check" CHECK("feedback"."status" IN ('new', 'reviewed', 'closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_request_unique` ON `feedback` (`request_id`);--> statement-breakpoint
CREATE INDEX `feedback_created_idx` ON `feedback` (`created_at`);