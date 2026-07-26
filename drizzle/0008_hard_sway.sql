CREATE TABLE `demo_video_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`requested_at` text NOT NULL,
	`narration_ready_at` text,
	`published_at` text,
	`duration_seconds` integer,
	`size_bytes` integer,
	`media_key` text,
	`error_code` text,
	CONSTRAINT "demo_video_jobs_status_check" CHECK("demo_video_jobs"."status" IN ('narrating', 'rendering', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `demo_video_jobs_requested_idx` ON `demo_video_jobs` (`requested_at`);--> statement-breakpoint
CREATE TABLE `demo_video_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`used_at` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `demo_video_nonces_expiry_idx` ON `demo_video_nonces` (`expires_at`);