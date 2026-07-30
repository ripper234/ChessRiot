CREATE TABLE `ai_usage_events` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` text NOT NULL,
	`scope` text NOT NULL,
	`version` text,
	`environment` text,
	`model` text,
	`purpose` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cached_input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`reasoning_tokens` integer DEFAULT 0 NOT NULL,
	`avoidable_tokens` integer,
	`cost_usd_micros` integer,
	`avoidable_cost_usd_micros` integer,
	`waste_rule` text,
	`source` text NOT NULL,
	`source_event_id` text NOT NULL,
	`request_count` integer DEFAULT 1 NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_usage_events_source_event_unique` ON `ai_usage_events` (`source`,`source_event_id`);--> statement-breakpoint
CREATE INDEX `ai_usage_events_occurred_at_idx` ON `ai_usage_events` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_events_version_idx` ON `ai_usage_events` (`version`);