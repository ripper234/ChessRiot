CREATE TABLE `demo_video_generation_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT "demo_video_generation_lock_id_check" CHECK("demo_video_generation_lock"."id" = 1)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_demo_video_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`requested_at` text NOT NULL,
	`narration_ready_at` text,
	`published_at` text,
	`duration_seconds` integer,
	`size_bytes` integer,
	`media_key` text,
	`error_code` text,
	CONSTRAINT "demo_video_jobs_status_check" CHECK("__new_demo_video_jobs"."status" IN ('narrating', 'rendering', 'publishing', 'ready', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_demo_video_jobs`("id", "status", "requested_at", "narration_ready_at", "published_at", "duration_seconds", "size_bytes", "media_key", "error_code") SELECT "id", "status", "requested_at", "narration_ready_at", "published_at", "duration_seconds", "size_bytes", "media_key", "error_code" FROM `demo_video_jobs`;--> statement-breakpoint
DROP TABLE `demo_video_jobs`;--> statement-breakpoint
ALTER TABLE `__new_demo_video_jobs` RENAME TO `demo_video_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `demo_video_jobs_requested_idx` ON `demo_video_jobs` (`requested_at`);