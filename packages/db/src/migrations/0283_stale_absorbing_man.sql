-- C14: idempotency guards added to Drizzle-generated DDL; schema unchanged.
ALTER TABLE "universe_layout_operations" ADD COLUMN IF NOT EXISTS "acknowledgement" jsonb;