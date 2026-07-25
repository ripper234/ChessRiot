ALTER TABLE `game_settings` ADD `magic_prompt` text;--> statement-breakpoint
ALTER TABLE `game_settings` ADD `magic_rules_json` text;--> statement-breakpoint
ALTER TABLE `moves` ADD `second_from_square` text;--> statement-breakpoint
ALTER TABLE `moves` ADD `second_to_square` text;--> statement-breakpoint
ALTER TABLE `moves` ADD `second_san` text;