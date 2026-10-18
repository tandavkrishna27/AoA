# Windows migrated-PostgreSQL fixture teardown — 18 October 2026

**Branch:** `docs/replatform-program`. **Base:** `eed114e7c25fef2f7a34fb57a1d6df3150b90c69`. **Fixture code candidate:** `41f2c2a68dd89e62f68e85246d38878488650b40`. Documentation publication is separate. Dates use India time; raw receipts retain their native timestamps.

**Verdict:** the approved shared-fixture teardown defect is repaired and verified with targeted tests on actual Windows x64 and Linux ARM64 VPS. Each host passes **4 files / 27 cases / no skips or failures**, including three real migrated-cluster shutdown cycles. Five selected Windows fixture postmasters/ports have no remaining processes/listeners; original review identities are preserved. No operator PostgreSQL cleanup was needed in this follow-up. This does not close the original historical F09 attribution, other fixture implementations or production crash custody.

See [portable evidence](../evidence/2026-10-18-windows-postgres-fixture-summary.json) and the updated [program checklist](../plans/2026-10-18-program-integration-handoff.md). The earlier combined-candidate report remains a record of the actual manual-cleanup incident, not rewritten as an automatic pass.

## Confirmed mechanism and root-cause boundary

The pinned `embedded-postgres@18.1.0-beta.16` Windows `stop()` spawns `taskkill /pid <postmaster> /f /t`, does not observe that command's completion/error, and resolves when the postmaster emits `exit`. It then deletes its data directory when `persistent:false`. A forced parent/tree termination is not an awaited normal PostgreSQL cluster shutdown. The shared `startMigratedDatabase` fixture compounded this by suppressing **all** client-close, cluster-stop and removal errors, then attempting removal regardless of the cleanup outcome.

Both defects are directly evidenced: the original 14-case unit selection fails 13 cases and passes one against the old helper; an actual old-helper Windows migrated-cluster probe fails the fast/normal shutdown contract. That single red probe leaves no process/listener residue, so it is **not** claimed to deterministically reproduce the earlier escaped `io_worker`. The previous captured postmaster/child/listener ownership remains evidence of that earlier run. Its exact scheduler/kernel escape interleaving and the original historical F09 incident remain unproven. The fix removes the unsafe stop/false-success mechanisms instead of guessing at that interleaving or broadly killing PostgreSQL processes.

## Fixture-only repair

- Capture the owned Windows PID-file identity after successful start: postmaster PID, normalized data directory, start time and allocated port. Re-read and require that receipt to match immediately before stopping.
- Resolve `pg_ctl.exe` from the native dependency belonging to the pinned embedded-postgres package, not arbitrary `PATH`. Use documented [PostgreSQL 18 fast, awaited shutdown](https://www.postgresql.org/docs/18/app-pg-ctl.html): `stop -D <owned-db> -m fast -w -t 15`, with a 20-second controller-process timeout, and require PID-file absence afterward.
- Override only this fixture instance's Windows `stop()`, before initialization. The dependency's exit hook calls the same memoized override: repeated teardown/hook calls cannot fall back to `taskkill` or re-signal a later reused PID after successful disposal. No global dependency patch or production startup change is made.
- Keep Linux's existing stop implementation. Set the shared fixture's cluster persistent so the helper, not the dependency, owns final deletion. Attempt every client close and stop; aggregate errors, retain the directory after any prior cleanup failure and surface removal errors. Memoize disposal so concurrent/repeated calls share one result.
- Preserve both setup and teardown failures rather than masking either. If Windows startup fails before a qualified receipt exists, refuse blind signaling and retain the directory/error for operator inspection. Controller failures/timeouts also fail teardown and preserve evidence; there is no force-kill fallback.

Only `server/src/__tests__/helpers/migrated-database.ts` and its two new regression files change. Application startup, migrations, dependencies/lockfile and other fixture implementations remain unchanged. This is ephemeral owned-fixture cleanup, not durable host-crash/PID-custody architecture.

## Targeted verification

All final checks use the clean committed fixture candidate above, pinned Node 24.19.0 and one file at a time. Native cycles are included in the 27 cases, not counted again as extra passing tests.

| Selected file | Windows | VPS |
| --- | ---: | ---: |
| `server/src/__tests__/helpers/__tests__/migrated-database.test.ts` | 17 pass | 17 pass |
| `server/src/__tests__/migrated-database-teardown.integration.test.ts` | 3 pass | 3 pass |
| `server/src/__tests__/hub-curation.integration.test.ts` | 4 pass | 4 pass |
| `server/src/__tests__/costs-idempotency.integration.test.ts` | 3 pass | 3 pass |
| **Total** | **27 pass, 0 skip/fail** | **27 pass, 0 skip/fail** |

Unit cases cover error aggregation, failed-stop/removal visibility, retained directories, setup plus cleanup errors, idempotence, actual controller-await ordering, changed/missing ownership receipts, controller failure/timeout, a lingering PID file and exit-hook reentry. The native cycles run the real full-schema helper, create/read fixture data, require fast-request/normal-completion log evidence, verify directory removal and rebind the exact port. Windows additionally inspects the actual postmaster/child creation identities and both address-family listeners before/after each cycle.

An independent Windows post-scan inventories all five postmasters/ports from the three cycles and original hub/cost consumers: no selected process or listener remains, and original 3210/54329 process creation identities are unchanged. Three-file-entry-point scoped TypeScript checking passes at the exact committed candidate. This is not recursive repository typecheck or the authoritative root build.

VPS verification runs as non-root `aoatest` in `/opt/aoa-windows-pg-fixture-20261018/source`, with an owned temp/evidence namespace and provider/ambient DB variables excluded. Frozen offline install passes; unchanged compiled dependency assets are reused from the previously verified combined source. No package/image build, shared-app deployment, Docker pruning or DB reset is needed for a fixture-only edit. Its final owned PostgreSQL scan is clear. Shared review service PID 301667 remains active at the combined application source; the same review DB ID/data are retained. The independent W12 live namespace is untouched.

### Preserved development attempts

The red unit/native probes are expected failures, not passes. Later development failures also remain in raw receipts: Vitest SSR did not support `import.meta.resolve`, corrected with nested `createRequire` resolution; replacing the native logging spy per cycle missed the callback cached in dependency defaults, corrected with one logger across cycles; an initial scoped typecheck configuration implicitly loaded an unrelated ambient `@types/diff` stub, corrected by selecting Node types. The final native log wait is condition-based. Intermediate test-instrumentation failures had no native process/listener residue. A failed shell-quoting inspection attempt made no changes; the inspection was rerun from a saved Python script.

## Evidence and reproduction

The portable summary checks five selected helper/test source identities against the committed candidate and both hosts, and publishes **66 raw receipt hashes**. Raw captures, native identities/logs, retained diagnostics and helper harnesses remain private outside Git under sibling `validation-windows-pg-fixture-2026-10-18/` and the owned VPS namespace. Generic capture unhandled counters remain `unknown`; successful native exits/JSON results are verified separately, not converted into a zero counter.

Reproduce the four named files with `node scripts/run-vitest-captured.mjs --capture-dir <fresh-directory> -- run <four-files> --no-file-parallelism --maxWorkers=1 --minWorkers=1`. Opt Windows into the native DB cases with `AOA_RUN_WIN_INTEGRATION=1`; set `AOA_FIXTURE_RECEIPTS_DIR` to a fresh private directory for cycle evidence. Scoped typecheck reproduction uses a temporary config extending server settings, the helper/two new test entry files, `noEmit`, and explicit Node types. Keep fresh captures and owned fixture paths; do not stop unrelated postmasters.

## Remaining limits

- Original historical F09 attribution/root cause and other fixture implementations are not established or repaired by this follow-up. The selected shared-helper normal-shutdown/error contract is repaired; not every helper consumer or Windows CI distribution is qualified.
- Startup-before-receipt or controller failure deliberately fails with retained evidence rather than guessing ownership; operator recovery may still be necessary for those abnormal failures.
- Native cycle JSON is emitted after successful shutdown/log checkpoints. Earlier failures retain their raw transcript; the fixture directory is retained when fixture cleanup itself fails before deletion. Later log/snapshot/assertion failures can occur after successful directory removal. Unconditional per-cycle failure receipt generation is a minor diagnostic improvement left separate.
- Full W02/W05/W12 live journeys, production crash custody, release/CI approval and the governed main-integration checkpoint remain open. No model call or credential-dependent journey is performed for this fixture validation.
