# Replatform and Universe migration-lineage reconciliation

Status: isolated integration-candidate evidence, 2026-10-11. This document records what the candidate proves; it does not declare a release baseline or authorize implementation on an official branch.

## Supported histories

The candidate supports two exact ordered Drizzle histories. Entries 0–282 (283 migrations) are byte-identical shared history. The fresh-install path is explicitly `replatform`. The replatform history currently ends at migration `0287_cute_mariko_yashida.sql` (journal index 287; 288 entries). The Universe history preserves its divergent migrations at indices 283–290 in `packages/db/src/migrations/lineages/universe/`, then uses the generated reconciliation migration `0291_windy_starbolt.sql` (journal index 291; 292 entries). Any later shared migrations must be represented in both registered histories with matching SQL hashes.

The archive includes the exact SQL and Drizzle metadata needed to recognize existing Universe databases. Root `meta/_journal.json` remains the canonical replatform journal, and fresh databases continue to follow that path. The manifest records the shared-prefix length, transition tags, and indexes; the registry validates those assertions and hashes the SQL bytes when it loads.

## Runtime behavior

At startup and before migration, the database ledger is matched by ordered hashes against a complete registered path. A database behind either supported path is reported as pending on that path. An exact complete path is compatible. Unknown, reordered, mixed-lineage, overlong, or unverifiable histories fail closed before schema changes. The migration coordinator rechecks under the advisory lock, applies only the selected path's pending entries, and verifies the resulting ledger. Readiness recognizes either exact path and reports a supported prefix as pending.

An empty database with no journal selects the declared fresh-install path. A populated database with no verifiable migration ledger is refused; the operator must restore lineage evidence or use an approved recovery procedure. The candidate must not infer lineage from timestamps or migration filenames alone.

## Evidence collected

- `pnpm -r --workspace-concurrency=1 build` passed across workspace packages (the UI emitted existing chunk-size and dynamic-import warnings).
- `@armyofagents/db` typecheck passed.
- Focused lineage classifier, registry, and advisory-lock unit tests passed (14 assertions/tests in the recorded run).
- After the C14 idempotency guards were added, a new disposable PostgreSQL 18.1 cluster applied the complete 288-entry fresh replatform path and inspected as `upToDate` on `replatform`.
- On that same disposable cluster, a second database was seeded by applying the exact 291-entry Universe prefix and writing the matching ordered migration hashes. `inspectMigrations` identified the Universe lineage with only `0291_windy_starbolt.sql` pending; `applyPendingMigrations` applied it and the final inspection reported `upToDate` on `universe` with 292 entries.
- A third disposable database with an unknown ledger hash was classified incompatible; migration was refused and a sentinel table remained unchanged.
- A focused run under the Codex Node 24.19 runtime confirmed the prior failure: the test compared a three-field patch object with `toContainEqual`, while `notificationPreferenceRuleSchema` materializes `soundEnabled: false` and `voiceEnabled: false`. The candidate changes only that test expectation to assert the two documented defaults explicitly; service and shared schema code remain unchanged. The focused file passes all 6 tests.
- An unconstrained full repository Vitest run then had two transient Windows-host failures: an `EPERM` rename in `slot-binding.test.ts` and a 5-second timeout in `required-migration-identity.test.ts`. Both files passed when rerun individually. A full rerun capped at four workers passed: 2,582 files passed, 232 skipped; 24,776 tests passed, 2,092 skipped, zero failed (26,868 total). This run used `pnpm test:run -- --maxWorkers=4 --reporter=dot` to reduce worker/resource contention.
- Repository-wide `pnpm -r typecheck` and `pnpm build` both pass on the same candidate. The build reports the existing absent generated snapshot notes and normal Vite chunk/dynamic-import warnings; no build error occurred.
- The JOB-003 contract test now passes. Its previous failure was a candidate inventory mismatch: two safe migration-ledger reads had moved into `inspectMigrations`, and the broad `.raw` scan incorrectly classified `express.raw` body-parser middleware as SQL. The test now records the moved query sites and excludes only the explicitly recognized Express raw-body parser; no production SQL behavior was changed for this correction.
- Four failures from the first full run were candidate-related and have been corrected: the new transition migration now guards all CREATE TABLE/INDEX statements for replay; the catch-up route helper is recognized by the RBAC pairing guard; the asset metadata test mocks and verifies the new Universe asset-access check; and the migration wiring assertion now checks the single centralized migration apply plus both startup call paths. All four focused test files pass (12 passed, 4 Windows integration cases skipped).
- Migration lineage classifier/registry tests pass (7 tests), and repository-wide `pnpm -r typecheck` passes. Both registered migration paths have now been exercised against real PostgreSQL after the guard edit. The PostgreSQL package logged expected notices for unavailable optional pgvector and PostgreSQL's identifier truncation; both migration paths completed successfully.
- On this Windows host, launching embedded PostgreSQL from the deeply nested pnpm store path failed with a missing-DLL exit. Running the same packaged binary through a short junction to the complete native package directory succeeded. This identifies a test-environment path constraint; no dependency or source change was made for it.

## Remaining gates

The candidate's tests, typecheck, build and both real-PostgreSQL migration paths now pass, but this does not itself adopt a baseline. The replatform source branch and its owners' schedule remain separate; this candidate neither changes nor pushes to that branch. Before adoption, independently review the generated migration SQL and archived snapshots against the exact upstream revisions, review the full staged integration diff, and record the explicit base-adoption decision. No official branch was committed or pushed as part of this reconciliation.
