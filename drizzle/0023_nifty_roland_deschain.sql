CREATE TABLE `runtime_invariants` (
	`id` integer PRIMARY KEY NOT NULL,
	`storage_epoch` text NOT NULL,
	`environment` text NOT NULL,
	`account_identity_marker` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "runtime_invariants_singleton_check" CHECK("runtime_invariants"."id" = 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runtime_invariants_storage_epoch_unique` ON `runtime_invariants` (`storage_epoch`);