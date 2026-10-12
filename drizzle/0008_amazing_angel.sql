CREATE TABLE `transformmate_catalog_exercise` (
	`owner_id` text NOT NULL,
	`account_scope` text NOT NULL,
	`generation` text NOT NULL,
	`locale` text NOT NULL,
	`exercise_id` integer NOT NULL,
	`summary` text NOT NULL,
	`summary_fetched_at` text NOT NULL,
	`detail` text,
	`detail_fetched_at` text,
	`in_full_catalog` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`owner_id`, `account_scope`, `generation`, `locale`, `exercise_id`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tm_catalog_exercise_id" CHECK("transformmate_catalog_exercise"."exercise_id" > 0),
	CONSTRAINT "tm_catalog_exercise_locale" CHECK("transformmate_catalog_exercise"."locale" = 'ru'),
	CONSTRAINT "tm_catalog_exercise_full" CHECK("transformmate_catalog_exercise"."in_full_catalog" in (0, 1)),
	CONSTRAINT "tm_catalog_exercise_detail_pair" CHECK(("transformmate_catalog_exercise"."detail" is null) = ("transformmate_catalog_exercise"."detail_fetched_at" is null))
);
--> statement-breakpoint
CREATE INDEX `tm_catalog_exercise_full_idx` ON `transformmate_catalog_exercise` (`owner_id`,`account_scope`,`generation`,`locale`,`in_full_catalog`);--> statement-breakpoint
CREATE TABLE `transformmate_catalog_query` (
	`owner_id` text NOT NULL,
	`account_scope` text NOT NULL,
	`generation` text NOT NULL,
	`locale` text NOT NULL,
	`query_key` text NOT NULL,
	`exercise_ids` text NOT NULL,
	`total` integer NOT NULL,
	`has_more` integer NOT NULL,
	`fetched_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `account_scope`, `generation`, `locale`, `query_key`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tm_catalog_query_total" CHECK("transformmate_catalog_query"."total" >= 0),
	CONSTRAINT "tm_catalog_query_locale" CHECK("transformmate_catalog_query"."locale" = 'ru'),
	CONSTRAINT "tm_catalog_query_more" CHECK("transformmate_catalog_query"."has_more" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX `tm_catalog_query_fetched_idx` ON `transformmate_catalog_query` (`owner_id`,`account_scope`,`generation`,`locale`,`fetched_at`);--> statement-breakpoint
CREATE TABLE `transformmate_catalog_state` (
	`owner_id` text NOT NULL,
	`account_scope` text NOT NULL,
	`generation` text NOT NULL,
	`locale` text NOT NULL,
	`dictionary` text,
	`dictionary_fetched_at` text,
	`full_catalog_fetched_at` text,
	`full_catalog_count` integer,
	PRIMARY KEY(`owner_id`, `account_scope`, `generation`, `locale`),
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tm_catalog_state_locale" CHECK("transformmate_catalog_state"."locale" = 'ru'),
	CONSTRAINT "tm_catalog_state_count" CHECK("transformmate_catalog_state"."full_catalog_count" is null or "transformmate_catalog_state"."full_catalog_count" between 0 and 10000),
	CONSTRAINT "tm_catalog_state_dictionary_pair" CHECK(("transformmate_catalog_state"."dictionary" is null) = ("transformmate_catalog_state"."dictionary_fetched_at" is null)),
	CONSTRAINT "tm_catalog_state_full_pair" CHECK(("transformmate_catalog_state"."full_catalog_count" is null) = ("transformmate_catalog_state"."full_catalog_fetched_at" is null))
);
