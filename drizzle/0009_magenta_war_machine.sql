CREATE TABLE `yazio_body_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`epoch` integer NOT NULL,
	`provider_id` text NOT NULL,
	`measurement_id` text,
	`metric` text NOT NULL,
	`provider_date_time` text NOT NULL,
	`synced_value` text,
	`remote_value` text,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`measurement_id`) REFERENCES `measurements`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "yazio_body_epoch_check" CHECK("yazio_body_links"."epoch" >= 0),
	CONSTRAINT "yazio_body_metric_check" CHECK("yazio_body_links"."metric" in ('weight','waist','hips','chest','thigh','biceps')),
	CONSTRAINT "yazio_body_uuid_check" CHECK(length("yazio_body_links"."provider_id")=36 and substr("yazio_body_links"."provider_id",9,1)='-' and substr("yazio_body_links"."provider_id",14,1)='-' and substr("yazio_body_links"."provider_id",19,1)='-' and substr("yazio_body_links"."provider_id",24,1)='-')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `yazio_body_provider_unique` ON `yazio_body_links` (`owner_id`,`epoch`,`provider_id`);--> statement-breakpoint
CREATE INDEX `yazio_body_measurement_idx` ON `yazio_body_links` (`owner_id`,`measurement_id`,`metric`);--> statement-breakpoint
CREATE TABLE `yazio_body_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`epoch` integer NOT NULL,
	`link_id` text NOT NULL,
	`revision` integer NOT NULL,
	`value` text NOT NULL,
	`baseline` text,
	`conflict_value` text,
	`state` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`link_id`) REFERENCES `yazio_body_links`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "yazio_body_revision_check" CHECK("yazio_body_outbox"."revision" > 0),
	CONSTRAINT "yazio_body_outbox_epoch_check" CHECK("yazio_body_outbox"."epoch" >= 0),
	CONSTRAINT "yazio_body_outbox_attempt_check" CHECK("yazio_body_outbox"."attempt" >= 0),
	CONSTRAINT "yazio_body_state_check" CHECK("yazio_body_outbox"."state" in ('pending','sending','uncertain','failed','conflict','done','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `yazio_body_job_revision_unique` ON `yazio_body_outbox` (`link_id`,`revision`);--> statement-breakpoint
CREATE INDEX `yazio_body_due_idx` ON `yazio_body_outbox` (`owner_id`,`epoch`,`state`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `yazio_body_link_jobs_idx` ON `yazio_body_outbox` (`link_id`,`created_at`);