CREATE TABLE `magic_rule_rejections` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`compiler_version` text NOT NULL,
	`code` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "magic_rule_rejections_code_check" CHECK("magic_rule_rejections"."code" IN ('unsupported', 'ambiguous'))
);
