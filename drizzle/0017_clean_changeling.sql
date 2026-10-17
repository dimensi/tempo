CREATE TABLE `transformmate_replica_garbage` (
	`key` text PRIMARY KEY NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transformmate_replica_jobs` (
	`owner_id` text NOT NULL,
	`account_scope` text NOT NULL,
	`locale` text NOT NULL,
	`key` text NOT NULL,
	`next_at` integer DEFAULT 0 NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`data` text NOT NULL,
	PRIMARY KEY(`owner_id`, `account_scope`, `locale`, `key`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tm_replica_due_idx` ON `transformmate_replica_jobs` (`owner_id`,`account_scope`,`locale`,`next_at`,`priority`);--> statement-breakpoint
CREATE TABLE `transformmate_replica_state` (
	`owner_id` text NOT NULL,
	`account_scope` text NOT NULL,
	`locale` text NOT NULL,
	`next_request_at` integer DEFAULT 0 NOT NULL,
	`blocked_until` integer DEFAULT 0 NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`reason` text,
	`connection_id` text,
	`last_success_at` integer,
	PRIMARY KEY(`owner_id`, `account_scope`, `locale`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP TABLE `transformmate_catalog_query`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transformmate_catalog_exercise` (
	`owner_id` text NOT NULL,
	`account_scope` text NOT NULL,
	`locale` text NOT NULL,
	`exercise_id` integer NOT NULL,
	`summary` text NOT NULL,
	`summary_fetched_at` text NOT NULL,
	`detail` text,
	`detail_fetched_at` text,
	`in_full_catalog` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`owner_id`, `account_scope`, `locale`, `exercise_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tm_catalog_exercise_id" CHECK("__new_transformmate_catalog_exercise"."exercise_id" > 0),
	CONSTRAINT "tm_catalog_exercise_locale" CHECK("__new_transformmate_catalog_exercise"."locale" = 'ru'),
	CONSTRAINT "tm_catalog_exercise_full" CHECK("__new_transformmate_catalog_exercise"."in_full_catalog" in (0, 1)),
	CONSTRAINT "tm_catalog_exercise_detail_pair" CHECK(("__new_transformmate_catalog_exercise"."detail" is null) = ("__new_transformmate_catalog_exercise"."detail_fetched_at" is null))
);
--> statement-breakpoint
-- Merge connection generations by stable owner/account identity. Keep the newest
-- detail even when a newer connection has only a short catalog summary.
INSERT INTO __new_transformmate_catalog_exercise
(owner_id,account_scope,locale,exercise_id,summary,summary_fetched_at,detail,detail_fetched_at,in_full_catalog)
SELECT e.owner_id,e.account_scope,e.locale,e.exercise_id,
 (SELECT r.summary FROM transformmate_catalog_exercise r WHERE r.owner_id=e.owner_id AND r.account_scope=e.account_scope AND r.locale=e.locale AND r.exercise_id=e.exercise_id ORDER BY r.summary_fetched_at DESC,r.rowid DESC LIMIT 1),
 max(e.summary_fetched_at),
 (SELECT r.detail FROM transformmate_catalog_exercise r WHERE r.owner_id=e.owner_id AND r.account_scope=e.account_scope AND r.locale=e.locale AND r.exercise_id=e.exercise_id AND r.detail IS NOT NULL ORDER BY r.detail_fetched_at DESC,r.rowid DESC LIMIT 1),
 max(e.detail_fetched_at),
 coalesce((SELECT r.in_full_catalog FROM transformmate_catalog_exercise r WHERE r.owner_id=e.owner_id AND r.account_scope=e.account_scope AND r.locale=e.locale AND r.exercise_id=e.exercise_id AND r.generation=(SELECT st.generation FROM transformmate_catalog_state st WHERE st.owner_id=e.owner_id AND st.account_scope=e.account_scope AND st.locale=e.locale AND st.full_catalog_fetched_at IS NOT NULL ORDER BY st.full_catalog_fetched_at DESC,st.rowid DESC LIMIT 1)),0)
FROM transformmate_catalog_exercise e GROUP BY e.owner_id,e.account_scope,e.locale,e.exercise_id;
--> statement-breakpoint
DROP TABLE `transformmate_catalog_exercise`;--> statement-breakpoint
ALTER TABLE `__new_transformmate_catalog_exercise` RENAME TO `transformmate_catalog_exercise`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `tm_catalog_exercise_full_idx` ON `transformmate_catalog_exercise` (`owner_id`,`account_scope`,`locale`,`in_full_catalog`);--> statement-breakpoint
CREATE TABLE `__new_transformmate_catalog_state` (
	`owner_id` text NOT NULL,
	`account_scope` text NOT NULL,
	`locale` text NOT NULL,
	`dictionary` text,
	`dictionary_fetched_at` text,
	`full_catalog_fetched_at` text,
	`full_catalog_count` integer,
	PRIMARY KEY(`owner_id`, `account_scope`, `locale`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tm_catalog_state_locale" CHECK("__new_transformmate_catalog_state"."locale" = 'ru'),
	CONSTRAINT "tm_catalog_state_count" CHECK("__new_transformmate_catalog_state"."full_catalog_count" is null or "__new_transformmate_catalog_state"."full_catalog_count" between 0 and 10000),
	CONSTRAINT "tm_catalog_state_dictionary_pair" CHECK(("__new_transformmate_catalog_state"."dictionary" is null) = ("__new_transformmate_catalog_state"."dictionary_fetched_at" is null)),
	CONSTRAINT "tm_catalog_state_full_pair" CHECK(("__new_transformmate_catalog_state"."full_catalog_count" is null) = ("__new_transformmate_catalog_state"."full_catalog_fetched_at" is null))
);
--> statement-breakpoint
INSERT INTO __new_transformmate_catalog_state
(owner_id,account_scope,locale,dictionary,dictionary_fetched_at,full_catalog_fetched_at,full_catalog_count)
SELECT e.owner_id,e.account_scope,e.locale,
 (SELECT st.dictionary FROM transformmate_catalog_state st WHERE st.owner_id=e.owner_id AND st.account_scope=e.account_scope AND st.locale=e.locale AND st.dictionary IS NOT NULL ORDER BY st.dictionary_fetched_at DESC,st.rowid DESC LIMIT 1),
 max(e.dictionary_fetched_at),max(e.full_catalog_fetched_at),
 CASE WHEN max(e.full_catalog_fetched_at) IS NULL THEN NULL ELSE (SELECT count(*) FROM transformmate_catalog_exercise r WHERE r.owner_id=e.owner_id AND r.account_scope=e.account_scope AND r.locale=e.locale AND r.in_full_catalog=1) END
FROM transformmate_catalog_state e GROUP BY e.owner_id,e.account_scope,e.locale;
--> statement-breakpoint
DROP TABLE `transformmate_catalog_state`;--> statement-breakpoint
ALTER TABLE `__new_transformmate_catalog_state` RENAME TO `transformmate_catalog_state`;
--> statement-breakpoint
-- The former bounded projection omitted stable video metadata. Materialize
-- explicit unknown values during migration; runtime accepts only the new shape.
UPDATE transformmate_catalog_exercise SET detail=json_set(detail,'$.kinescope_data',json((
 SELECT json_group_array(json(json_set(value,'$.id',json_extract(value,'$.id'),'$.resolution',json_extract(value,'$.resolution'))))
 FROM json_each(detail,'$.kinescope_data')
))) WHERE detail IS NOT NULL AND json_type(detail,'$.kinescope_data')='array';

--> statement-breakpoint
UPDATE transformmate_catalog_exercise SET detail=json_set(detail,'$.videoMetadataComplete',json('false')) WHERE detail IS NOT NULL;
