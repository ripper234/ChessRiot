PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_game_settings` (
	`game_id` text PRIMARY KEY NOT NULL,
	`game_mode` text DEFAULT 'multiplayer' NOT NULL,
	`variant_id` text DEFAULT 'standard' NOT NULL,
	`ai_difficulty` integer,
	`human_color` text DEFAULT 'w' NOT NULL,
	`turn_pace_days` integer,
	`magic_prompt` text,
	`magic_rules_json` text,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "game_settings_game_mode_check" CHECK("__new_game_settings"."game_mode" IN ('solo', 'multiplayer')),
	CONSTRAINT "game_settings_variant_id_check" CHECK("__new_game_settings"."variant_id" IN (
        'standard',
        'pawn-riot',
        'half-army',
        'pawn-duel',
        'mate-pawn',
        'mate-rook',
        'mate-two-bishops'
      )),
	CONSTRAINT "game_settings_ai_difficulty_check" CHECK("__new_game_settings"."ai_difficulty" IS NULL OR "__new_game_settings"."ai_difficulty" BETWEEN 1 AND 5),
	CONSTRAINT "game_settings_human_color_check" CHECK("__new_game_settings"."human_color" IN ('w', 'b')),
	CONSTRAINT "game_settings_turn_pace_days_check" CHECK("__new_game_settings"."turn_pace_days" IS NULL OR "__new_game_settings"."turn_pace_days" IN (1, 3, 5)),
	CONSTRAINT "game_settings_mode_difficulty_check" CHECK((
        ("__new_game_settings"."game_mode" = 'solo' AND "__new_game_settings"."ai_difficulty" IS NOT NULL) OR
        ("__new_game_settings"."game_mode" = 'multiplayer' AND "__new_game_settings"."ai_difficulty" IS NULL)
      ))
);
--> statement-breakpoint
INSERT INTO `__new_game_settings`("game_id", "game_mode", "variant_id", "ai_difficulty", "human_color", "turn_pace_days", "magic_prompt", "magic_rules_json") SELECT "game_id", "game_mode", "variant_id", "ai_difficulty", "human_color", "turn_pace_days", "magic_prompt", "magic_rules_json" FROM `game_settings`;--> statement-breakpoint
DROP TABLE `game_settings`;--> statement-breakpoint
ALTER TABLE `__new_game_settings` RENAME TO `game_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;