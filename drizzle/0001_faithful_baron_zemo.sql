CREATE TABLE `game_settings` (
	`game_id` text PRIMARY KEY NOT NULL,
	`game_mode` text DEFAULT 'multiplayer' NOT NULL,
	`ai_difficulty` integer
);
