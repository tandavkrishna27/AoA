-- C14: idempotency guards on Drizzle-generated DDL for migration-job replay.
ALTER TABLE "job_artifacts" ADD COLUMN IF NOT EXISTS "recovery_quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_artifacts" ADD COLUMN IF NOT EXISTS "recovery_quarantine_reason" text;
