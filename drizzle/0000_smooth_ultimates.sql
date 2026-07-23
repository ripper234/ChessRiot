CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`create_request_id` text NOT NULL,
	`status` text NOT NULL,
	`white_name` text NOT NULL,
	`black_name` text,
	`white_token_hash` text NOT NULL,
	`black_token_hash` text,
	`invite_token_hash` text NOT NULL,
	`initial_fen` text NOT NULL,
	`current_fen` text NOT NULL,
	`turn_color` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`ply_count` integer DEFAULT 0 NOT NULL,
	`winner_color` text,
	`termination` text,
	`last_mutation_nonce` text,
	`created_at` text NOT NULL,
	`joined_at` text,
	`updated_at` text NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_create_request_unique` ON `games` (`create_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `games_invite_token_unique` ON `games` (`invite_token_hash`);--> statement-breakpoint
CREATE TABLE `moves` (
	`game_id` text NOT NULL,
	`ply` integer NOT NULL,
	`request_id` text NOT NULL,
	`color` text NOT NULL,
	`from_square` text NOT NULL,
	`to_square` text NOT NULL,
	`promotion` text,
	`san` text NOT NULL,
	`fen_before` text NOT NULL,
	`fen_after` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`game_id`, `ply`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `moves_request_unique` ON `moves` (`game_id`,`request_id`);