CREATE TABLE `game_actions` (
	`game_id` text NOT NULL,
	`request_id` text NOT NULL,
	`action_type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`game_id`, `request_id`)
);
--> statement-breakpoint
CREATE TABLE `observability_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`environment` text NOT NULL,
	`app_version` text NOT NULL,
	`event_name` text NOT NULL,
	`outcome` text NOT NULL,
	`request_id` text,
	`subject_hash` text,
	`route` text,
	`method` text,
	`status_code` integer,
	`error_code` text,
	`latency_ms` integer,
	`metadata_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `observability_events_id_unique` ON `observability_events` (`id`);--> statement-breakpoint
CREATE INDEX `observability_time_idx` ON `observability_events` (`occurred_at` DESC);--> statement-breakpoint
CREATE INDEX `observability_event_time_idx` ON `observability_events` (`event_name`, `occurred_at` DESC);--> statement-breakpoint
CREATE INDEX `observability_outcome_time_idx` ON `observability_events` (`outcome`, `occurred_at` DESC);--> statement-breakpoint
CREATE INDEX `observability_subject_time_idx` ON `observability_events` (`subject_hash`, `occurred_at` DESC);--> statement-breakpoint
CREATE TRIGGER `observability_hard_cap`
AFTER INSERT ON `observability_events`
BEGIN
  DELETE FROM `observability_events`
  WHERE `id` IN (
    SELECT `id` FROM `observability_events`
    ORDER BY `occurred_at` DESC
    LIMIT -1 OFFSET 20000
  );
END;--> statement-breakpoint
ALTER TABLE `game_settings` ADD `human_color` text DEFAULT 'w' NOT NULL;
