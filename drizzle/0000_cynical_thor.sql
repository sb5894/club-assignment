CREATE TABLE `application_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`student_id` text NOT NULL,
	`version` integer NOT NULL,
	`choices_json` text NOT NULL,
	`submitted_at` text NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_revision_version` ON `application_revisions` (`student_id`,`version`);--> statement-breakpoint
CREATE TABLE `applications` (
	`student_id` text PRIMARY KEY NOT NULL,
	`choices_json` text NOT NULL,
	`version` integer NOT NULL,
	`submitted_at` text NOT NULL,
	`verified_at` text,
	`verified_version` integer,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `operation_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `school_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`phase` text DEFAULT 'setup' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`clubs_json` text NOT NULL,
	`result_json` text,
	`last_operation_id` text,
	`updated_at` text NOT NULL,
	CONSTRAINT "school_singleton" CHECK("school_state"."id" = 1),
	CONSTRAINT "school_phase" CHECK("school_state"."phase" IN ('setup','open','closed','allocated','final'))
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`student_id` text,
	`credential_version` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`grade` integer NOT NULL,
	`class_no` integer NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`gender` text NOT NULL,
	`code_hash` text NOT NULL,
	`code_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_code_hash_unique` ON `students` (`code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `student_identity` ON `students` (`grade`,`class_no`,`number`);
--> statement-breakpoint
CREATE TRIGGER application_history_insert AFTER INSERT ON applications
BEGIN
  INSERT INTO application_revisions(student_id,version,choices_json,submitted_at)
  VALUES(NEW.student_id,NEW.version,NEW.choices_json,NEW.submitted_at);
END;
--> statement-breakpoint
CREATE TRIGGER application_history_update AFTER UPDATE OF choices_json ON applications
BEGIN
  INSERT INTO application_revisions(student_id,version,choices_json,submitted_at)
  VALUES(NEW.student_id,NEW.version,NEW.choices_json,NEW.submitted_at);
END;
--> statement-breakpoint
CREATE TRIGGER application_revision_no_update BEFORE UPDATE ON application_revisions
BEGIN
  SELECT RAISE(ABORT,'Application history is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER application_revision_no_delete BEFORE DELETE ON application_revisions
BEGIN
  SELECT RAISE(ABORT,'Application history is immutable');
END;
