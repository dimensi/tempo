CREATE TABLE `workout_transformmate_native` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_scope` text NOT NULL,
	`remote_training_id` integer NOT NULL,
	`date` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`snapshot` text NOT NULL,
	`fetched_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workout_tm_native_revision_positive" CHECK("workout_transformmate_native"."revision" >= 1),
	CONSTRAINT "workout_tm_native_remote_positive" CHECK("workout_transformmate_native"."remote_training_id" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workout_tm_native_remote_unique` ON `workout_transformmate_native` (`owner_id`,`account_scope`,`remote_training_id`);--> statement-breakpoint
CREATE INDEX `workout_tm_native_date_idx` ON `workout_transformmate_native` (`owner_id`,`account_scope`,`date`);