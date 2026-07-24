ALTER TABLE `game_settings` ADD `turn_pace_days` integer
  CHECK (`turn_pace_days` IS NULL OR `turn_pace_days` IN (1, 3, 5));
