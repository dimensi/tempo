CREATE TABLE `cardio_workouts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`date` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`manual` text,
	`imported` text,
	`overrides` text,
	`link_kind` text,
	`link_id` text,
	`automatic_link` integer DEFAULT false NOT NULL,
	`suppress_match` integer DEFAULT false NOT NULL,
	`present` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cardio_workouts_owner_date_idx` ON `cardio_workouts` (`owner_id`,`date`);--> statement-breakpoint
CREATE UNIQUE INDEX `cardio_workouts_target_unique` ON `cardio_workouts` (`owner_id`,`link_kind`,`link_id`) WHERE present = 1;--> statement-breakpoint
CREATE TABLE `yazio_exercise_coverage` (
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`fetched_at` text,
	`failed_at` text,
	PRIMARY KEY(`owner_id`, `date`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
