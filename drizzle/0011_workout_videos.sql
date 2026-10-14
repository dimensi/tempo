CREATE TABLE `workout_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`size` integer NOT NULL,
	`duration` integer NOT NULL,
	`state` text NOT NULL,
	`parts` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_videos_session_idx` ON `workout_videos` (`owner_id`,`session_id`);
--> statement-breakpoint
-- Persist occurrence IDs once, retaining every existing exercise field and array order.
UPDATE workout_sessions SET data = json_set(data, '$.exercises', json((
  SELECT json_group_array(json_set(value, '$.id', COALESCE(json_extract(value, '$.id'),
    lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))
  ))) FROM json_each(workout_sessions.data, '$.exercises')
)));
