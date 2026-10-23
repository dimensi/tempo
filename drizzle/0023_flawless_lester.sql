CREATE TABLE `yazio_daily_goals` (
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`calories` text,
	`steps` integer,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `date`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "yazio_goals_steps_check" CHECK("yazio_daily_goals"."steps" is null or (typeof("yazio_daily_goals"."steps") = 'integer' and "yazio_daily_goals"."steps" between 1 and 9007199254740991))
);
--> statement-breakpoint
ALTER TABLE `nutrition_schedule` ADD `automatic_attempt_at` integer;--> statement-breakpoint
ALTER TABLE `nutrition_schedule` ADD `recent_success_at` integer;--> statement-breakpoint
ALTER TABLE `nutrition_schedule` ADD `recent_success_date` text;