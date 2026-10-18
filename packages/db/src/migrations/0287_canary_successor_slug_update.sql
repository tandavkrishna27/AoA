-- C14 / Decision #122: the explicit canary-successor handoff updates only the
-- routing slug through aoa_app. drizzle-kit cannot emit role/column GRANT DDL;
-- repeating GRANT is idempotent. No table-wide UPDATE authority is added.
GRANT UPDATE ("slug") ON "public"."execution_targets" TO "aoa_app";
