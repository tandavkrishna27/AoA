ALTER TABLE "job_artifacts" ADD COLUMN "recovery_quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_artifacts" ADD COLUMN "recovery_quarantine_reason" text;