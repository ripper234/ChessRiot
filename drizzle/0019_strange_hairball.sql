CREATE TABLE `game_recap_shares` (
	`id` text PRIMARY KEY NOT NULL,
	`game_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_recap_shares_game_unique` ON `game_recap_shares` (`game_id`);