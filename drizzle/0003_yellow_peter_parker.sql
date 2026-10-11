CREATE TABLE `nutrition_schedule` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`initial_from` text,
	`epoch` integer DEFAULT 0 NOT NULL,
	`last_success` integer,
	`last_error` text,
	`next_run_at` integer,
	`attempt` integer DEFAULT 0 NOT NULL,
	`lease_id` text,
	`lease_expires_at` integer,
	`lease_started_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "nutrition_schedule_attempt" CHECK("nutrition_schedule"."attempt" between 0 and 3)
);
--> statement-breakpoint
CREATE INDEX `nutrition_schedule_due_idx` ON `nutrition_schedule` (`enabled`,`next_run_at`);