CREATE TABLE `referral_links` (
	`account_id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "referral_links_code_check" CHECK(length("referral_links"."code") = 16 AND "referral_links"."code" NOT GLOB '*[^A-Za-z0-9_-]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_links_code_unique` ON `referral_links` (`code`);--> statement-breakpoint
CREATE TABLE `referral_attributions` (
	`referred_account_id` text PRIMARY KEY NOT NULL,
	`referrer_account_id` text NOT NULL,
	`referral_code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`credits` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`referred_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`referrer_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`referral_code`) REFERENCES `referral_links`(`code`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "referral_attributions_status_check" CHECK("referral_attributions"."status" IN ('pending', 'rewarded')),
	CONSTRAINT "referral_attributions_people_check" CHECK("referral_attributions"."referrer_account_id" <> "referral_attributions"."referred_account_id"),
	CONSTRAINT "referral_attributions_credits_check" CHECK((
        ("referral_attributions"."status" = 'pending' AND "referral_attributions"."credits" = 0 AND "referral_attributions"."completed_at" IS NULL) OR
        ("referral_attributions"."status" = 'rewarded' AND "referral_attributions"."credits" > 0 AND "referral_attributions"."completed_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE INDEX `referral_attributions_referrer_status_idx` ON `referral_attributions` (`referrer_account_id`,`status`,`created_at`);
