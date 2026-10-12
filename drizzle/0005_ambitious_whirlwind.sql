CREATE TABLE `workout_transformmate_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`workout_id` text NOT NULL,
	`remote_training_id` integer,
	`revision` integer DEFAULT 1 NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workout_tm_local_unique` ON `workout_transformmate_links` (`owner_id`,`plan_id`,`workout_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workout_tm_remote_unique` ON `workout_transformmate_links` (`owner_id`,`remote_training_id`);