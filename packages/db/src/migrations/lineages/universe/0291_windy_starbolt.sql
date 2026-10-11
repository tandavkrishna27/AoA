ALTER TABLE "internal_agent_runs" ADD COLUMN "distributed_warm_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ADD COLUMN "distributed_warm_state" jsonb;--> statement-breakpoint
ALTER TABLE "job_artifacts" ADD COLUMN "recovery_quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_artifacts" ADD COLUMN "recovery_quarantine_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ia_runs_distributed_warm_conversation_uq" ON "internal_agent_runs" USING btree ("company_id","user_id","distributed_warm_conversation_id") WHERE distributed_warm_state IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "job_artifacts_expired_identity_uidx" ON "job_artifacts" USING btree ("organization_id","job_id","attempt","identifier") WHERE status = 'expired';--> statement-breakpoint
CREATE INDEX "job_artifacts_committed_retention_idx" ON "job_artifacts" USING btree ("kind","expires_at","id") WHERE status = 'committed';--> statement-breakpoint
ALTER TABLE "internal_agent_runs" ADD CONSTRAINT "ia_runs_distributed_warm_turn_check" CHECK (distributed_warm_state IS NULL OR (
      trigger_type = 'conversation' AND user_id IS NOT NULL AND
      distributed_warm_conversation_id IS NOT NULL
    ));