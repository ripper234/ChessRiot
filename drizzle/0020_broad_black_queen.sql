CREATE INDEX `accounts_created_idx` ON `accounts` (`created_at`);--> statement-breakpoint
CREATE INDEX `friend_requests_created_idx` ON `friend_requests` (`created_at`);--> statement-breakpoint
CREATE INDEX `games_created_idx` ON `games` (`created_at`);--> statement-breakpoint
CREATE INDEX `games_finished_idx` ON `games` (`finished_at`);--> statement-breakpoint
CREATE INDEX `moves_created_idx` ON `moves` (`created_at`);--> statement-breakpoint
CREATE INDEX `observability_actor_time_idx` ON `observability_events` (`actor_hash`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `referral_attributions_status_completed_idx` ON `referral_attributions` (`status`,`completed_at`);