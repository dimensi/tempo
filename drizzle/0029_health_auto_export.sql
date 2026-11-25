CREATE TABLE `health_auto_export_connections` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`token_digest` text,
	`last_attempt_at` text,
	`last_success_at` text,
	`last_inserted` integer,
	`last_error_at` text,
	`last_error_code` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "health_auto_export_token_digest_length" CHECK("health_auto_export_connections"."token_digest" is null or length("health_auto_export_connections"."token_digest") = 64)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `health_auto_export_connections_token_digest_unique` ON `health_auto_export_connections` (`token_digest`);--> statement-breakpoint
CREATE TABLE `health_auto_export_samples` (
	`owner_id` text NOT NULL,
	`sample_key` text NOT NULL,
	`metric` text NOT NULL,
	`source` text,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`start_offset_minutes` integer NOT NULL,
	`end_offset_minutes` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`stage` text,
	`value` real,
	`unit` text NOT NULL,
	`min` real,
	`max` real,
	PRIMARY KEY(`owner_id`, `sample_key`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "health_auto_export_sample_bounds" CHECK("health_auto_export_samples"."end_at" >= "health_auto_export_samples"."start_at")
);
--> statement-breakpoint
CREATE INDEX `health_auto_export_sample_owner_local_date` ON `health_auto_export_samples` (`owner_id`,`end_date`,`start_date`);