CREATE TABLE IF NOT EXISTS `magic_rule_compilations` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`compiler_version` text NOT NULL,
	`status` text NOT NULL,
	`rules_json` text,
	`lease_token` text,
	`lease_until` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "magic_rule_compilations_status_check" CHECK("magic_rule_compilations"."status" IN ('pending', 'ready')),
	CONSTRAINT "magic_rule_compilations_ready_check" CHECK((
        ("magic_rule_compilations"."status" = 'ready' AND "magic_rule_compilations"."rules_json" IS NOT NULL
          AND "magic_rule_compilations"."lease_token" IS NULL AND "magic_rule_compilations"."lease_until" IS NULL) OR
        ("magic_rule_compilations"."status" = 'pending' AND "magic_rule_compilations"."rules_json" IS NULL
          AND "magic_rule_compilations"."lease_token" IS NOT NULL AND "magic_rule_compilations"."lease_until" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `magic_rule_compilations_status_lease_idx` ON `magic_rule_compilations` (`status`,`lease_until`);
