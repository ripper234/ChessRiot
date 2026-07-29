ALTER TABLE `game_settings`
ADD `variant_id` text DEFAULT 'standard' NOT NULL
CHECK (`variant_id` IN ('standard', 'pawn-riot', 'half-army', 'pawn-duel'));
