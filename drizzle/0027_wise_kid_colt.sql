CREATE TABLE `exercise_technique_descriptions` (
	`owner_id` text NOT NULL,
	`account_scope` text NOT NULL,
	`exercise_id` integer NOT NULL,
	`description` text,
	`revision` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `account_scope`, `exercise_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exercise_technique_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_scope` text NOT NULL,
	`exercise_id` integer NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`last_modified` integer,
	`parts` text NOT NULL,
	`state` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`error` text,
	`playback_size` integer,
	`submitted_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_technique_ready_idx` ON `exercise_technique_videos` (`owner_id`,`account_scope`,`exercise_id`) WHERE "exercise_technique_videos"."state" = 'ready';--> statement-breakpoint
CREATE UNIQUE INDEX `exercise_technique_candidate_idx` ON `exercise_technique_videos` (`owner_id`,`account_scope`,`exercise_id`) WHERE "exercise_technique_videos"."state" in ('uploading', 'processing', 'failed');--> statement-breakpoint
CREATE INDEX `exercise_technique_jobs_idx` ON `exercise_technique_videos` (`state`,`created_at`);