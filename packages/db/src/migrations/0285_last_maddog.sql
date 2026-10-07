-- C14: idempotency guard appended to Drizzle-generated DDL.
CREATE INDEX IF NOT EXISTS "job_artifacts_committed_retention_idx" ON "job_artifacts" USING btree ("kind","expires_at","id") WHERE status = 'committed';
