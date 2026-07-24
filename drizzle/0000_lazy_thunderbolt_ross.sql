CREATE TABLE `deployment_registry` (
	`environment` text PRIMARY KEY NOT NULL,
	`deployed_version` text NOT NULL,
	`deployed_at` text,
	`verified_at` text,
	`runtime_version` text,
	`health_state` text DEFAULT 'unknown' NOT NULL,
	`health_status` text,
	`database_status` text,
	`last_health_at` text,
	`last_checked_at` text,
	`updated_at` text NOT NULL
);
