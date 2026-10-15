CREATE TABLE `owner_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`daily_steps_goal` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "owner_settings_steps_goal_check" CHECK("owner_settings"."daily_steps_goal" is null or (typeof("owner_settings"."daily_steps_goal") = 'integer' and "owner_settings"."daily_steps_goal" between 1 and 9007199254740991))
);
