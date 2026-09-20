PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_magic_rule_compilations` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`compiler_version` text NOT NULL,
	`status` text NOT NULL,
	`rules_json` text,
	`world_code` text,
	`lease_token` text,
	`lease_until` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "magic_rule_compilations_status_check" CHECK("__new_magic_rule_compilations"."status" IN ('pending', 'compiled', 'ready')),
	CONSTRAINT "magic_rule_compilations_state_check" CHECK((
        ("__new_magic_rule_compilations"."status" = 'ready' AND "__new_magic_rule_compilations"."rules_json" IS NOT NULL
          AND "__new_magic_rule_compilations"."world_code" IS NOT NULL
          AND "__new_magic_rule_compilations"."lease_token" IS NULL AND "__new_magic_rule_compilations"."lease_until" IS NULL) OR
        ("__new_magic_rule_compilations"."status" = 'compiled' AND "__new_magic_rule_compilations"."rules_json" IS NOT NULL
          AND "__new_magic_rule_compilations"."world_code" IS NULL
          AND "__new_magic_rule_compilations"."lease_token" IS NULL AND "__new_magic_rule_compilations"."lease_until" IS NULL) OR
        ("__new_magic_rule_compilations"."status" = 'pending' AND "__new_magic_rule_compilations"."rules_json" IS NULL
          AND "__new_magic_rule_compilations"."world_code" IS NULL
          AND "__new_magic_rule_compilations"."lease_token" IS NOT NULL AND "__new_magic_rule_compilations"."lease_until" IS NOT NULL)
      ))
);
--> statement-breakpoint
INSERT INTO `__new_magic_rule_compilations`("cache_key", "compiler_version", "status", "rules_json", "world_code", "lease_token", "lease_until", "created_at", "updated_at") SELECT "cache_key", "compiler_version", CASE WHEN "status" = 'ready' AND "world_code" IS NULL THEN 'compiled' ELSE "status" END, "rules_json", "world_code", "lease_token", "lease_until", "created_at", "updated_at" FROM `magic_rule_compilations`;--> statement-breakpoint
DROP TABLE `magic_rule_compilations`;--> statement-breakpoint
ALTER TABLE `__new_magic_rule_compilations` RENAME TO `magic_rule_compilations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `magic_rule_compilations_status_lease_idx` ON `magic_rule_compilations` (`status`,`lease_until`);
