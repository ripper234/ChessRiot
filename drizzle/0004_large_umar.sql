CREATE TABLE `game_reactions` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`game_id` text NOT NULL,
	`request_id` text NOT NULL,
	`sender_color` text NOT NULL,
	`reaction_key` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "game_reactions_color_check" CHECK("game_reactions"."sender_color" IN ('w', 'b')),
	CONSTRAINT "game_reactions_key_check" CHECK("game_reactions"."reaction_key" IN ('hi', 'good_luck', 'nice_move', 'well_played', 'good_game', 'thanks'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_reactions_id_unique` ON `game_reactions` (`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `game_reactions_request_unique` ON `game_reactions` (`game_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `game_reactions_game_sequence_idx` ON `game_reactions` (`game_id`,`sequence`);