CREATE TABLE `nutrition_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`daytime` text NOT NULL,
	`source` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`source_url` text,
	`observed_at` text NOT NULL,
	`mime` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "nutrition_photo_source" CHECK("nutrition_photos"."source" in ('yazio', 'manual')),
	CONSTRAINT "nutrition_photo_daytime" CHECK("nutrition_photos"."daytime" in ('breakfast', 'lunch', 'dinner', 'snack'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nutrition_yazio_photo_slot` ON `nutrition_photos` (`owner_id`,`date`,`daytime`) WHERE "nutrition_photos"."source" = 'yazio';--> statement-breakpoint
CREATE INDEX `nutrition_photo_day` ON `nutrition_photos` (`owner_id`,`date`);--> statement-breakpoint
CREATE TABLE `nutrition_cache` (
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`id` text NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `kind`, `id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `nutrition_days` (
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`snapshot` text NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `date`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `nutrition_sync_runs` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
