CREATE TABLE `game_create_intents` (
	`request_id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`lease_token` text NOT NULL,
	`lease_until` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `game_create_intents_lease_idx` ON `game_create_intents` (`lease_until`);--> statement-breakpoint
CREATE TABLE `magic_rule_compilations` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`compiler_version` text NOT NULL,
	`status` text NOT NULL,
	`rules_json` text,
	`lease_token` text,
	`lease_until` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "magic_rule_compilations_status_check" CHECK("magic_rule_compilations"."status" IN ('pending', 'ready')),
	CONSTRAINT "magic_rule_compilations_state_check" CHECK((
        ("magic_rule_compilations"."status" = 'pending' AND "magic_rule_compilations"."rules_json" IS NULL
          AND "magic_rule_compilations"."lease_token" IS NOT NULL AND "magic_rule_compilations"."lease_until" IS NOT NULL)
        OR
        ("magic_rule_compilations"."status" = 'ready' AND "magic_rule_compilations"."rules_json" IS NOT NULL
          AND "magic_rule_compilations"."lease_token" IS NULL AND "magic_rule_compilations"."lease_until" IS NULL)
      ))
);
--> statement-breakpoint
CREATE INDEX `magic_rule_compilations_lease_idx` ON `magic_rule_compilations` (`status`,`lease_until`);--> statement-breakpoint
ALTER TABLE `moves` ADD `continuation_json` text;
