CREATE TABLE `yazio_daily_steps` (
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`steps` integer,
	`observed_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `date`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "yazio_steps_date_check" CHECK("yazio_daily_steps"."date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "yazio_steps_count_check" CHECK("yazio_daily_steps"."steps" is null or (typeof("yazio_daily_steps"."steps") = 'integer' and "yazio_daily_steps"."steps" between 0 and 9007199254740991))
);
--> statement-breakpoint
CREATE TABLE `yazio_weight_entries` (
	`owner_id` text NOT NULL,
	`external_id` text NOT NULL,
	`provider_date` text NOT NULL,
	`measured_date` text,
	`raw_value` text,
	`unit` text,
	`unit_context` text,
	`upstream_source` text,
	`gateway` text,
	`observed_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `external_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "yazio_weight_external_id_check" CHECK(length("yazio_weight_entries"."external_id") = 36 and "yazio_weight_entries"."external_id" = lower("yazio_weight_entries"."external_id")),
	CONSTRAINT "yazio_weight_provider_date_check" CHECK(length("yazio_weight_entries"."provider_date") between 1 and 128),
	CONSTRAINT "yazio_weight_measured_date_check" CHECK("yazio_weight_entries"."measured_date" is null or "yazio_weight_entries"."measured_date" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
	CONSTRAINT "yazio_weight_unit_unknown_check" CHECK("yazio_weight_entries"."unit" is null),
	CONSTRAINT "yazio_weight_context_check" CHECK("yazio_weight_entries"."unit_context" is null or length("yazio_weight_entries"."unit_context") <= 128),
	CONSTRAINT "yazio_weight_source_check" CHECK("yazio_weight_entries"."upstream_source" is null or length("yazio_weight_entries"."upstream_source") <= 128),
	CONSTRAINT "yazio_weight_gateway_check" CHECK("yazio_weight_entries"."gateway" is null or length("yazio_weight_entries"."gateway") <= 128)
);
--> statement-breakpoint
CREATE INDEX `yazio_weight_owner_date_idx` ON `yazio_weight_entries` (`owner_id`,`measured_date`);