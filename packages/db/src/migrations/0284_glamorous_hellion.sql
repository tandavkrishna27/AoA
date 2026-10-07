-- C14: idempotency guard appended to Drizzle-generated DDL.
CREATE UNIQUE INDEX IF NOT EXISTS "job_artifacts_expired_identity_uidx" ON "job_artifacts" USING btree ("organization_id","job_id","attempt","identifier") WHERE status = 'expired';
