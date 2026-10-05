# M1a direct code-and-test checklist

**Updated:** `2026-10-06`
**Integration branch:** `docs/replatform-program`
**Status:** implementation and testing in progress

PR [#644](https://github.com/tandavkrishna27/AoA/pull/644) is merged into this
integration branch at `17be6bc0f92d66b95020971a6b7d2df83fc59b88`. Its required
CI passed in [37354192434](https://github.com/tandavkrishna27/AoA/actions/runs/37354192434).
The merge has the same file tree as tested branch head
`da7dd8c84770558039881777a069235053b2f072`. The current D1 run
[37354212913](https://github.com/tandavkrishna27/AoA/actions/runs/37354212913)
has passed core and spine; its fault matrix is still running.

Updated-candidate keyless boot
[37356828601](https://github.com/tandavkrishna27/AoA/actions/runs/37356828601)
passed on `17be6bc0f`: all three source-built image revisions match, all 14
tenant/refusal cases fired with successful own-tenant controls, the suppressed
arm refused all 14 missing injections, and cleanup readback found no remaining
containers, networks or volumes. The control task stayed legacy with zero
distributed jobs; its missing local Claude executable is an expected keyless
control outcome, not a successful model task. Real-E2B run
[37359163188](https://github.com/tandavkrishna27/AoA/actions/runs/37359163188)
is in progress on that same integration revision.

## Current acceptance

The [October 5 founder amendment](../../test-gates.md#m1-code-and-test-acceptance--founder-amendment-2026-10-05)
replaces the former certification process for M1a and M1b. Complete M1a with
working code and meaningful tests, then proceed to M1b. Record the tested SHA
and results here; no additional certificate, archive, freeze or handoff is owed.

| Behavior | Executable check | Current result |
|---|---|---|
| Repository compiles and builds | `pnpm -r typecheck`; `pnpm build` | Both passed locally, October 5 |
| Existing product regressions | `pnpm test:run --maxWorkers=4` | Restart-fix rerun passed: 2,444 files / 23,500 tests; 222 files / 1,832 tests skipped. First run hit one 30-second app-import hook timeout during concurrent build/typecheck; that suite passed all 7 tests alone and the complete suite then passed. Skips remain unproven |
| Concurrent leasing and ACK | Lease integration tests; live D1 lease races | Six real-Postgres suites passed (113 tests); ACK and adjacent regression suites passed (25 tests). Core D1 passed on `da7dd8c84` in [37354212913](https://github.com/tandavkrishna27/AoA/actions/runs/37354212913) |
| Worker owns distributed execution | Live `m1-spine`, including the wrong-executor control | Passed on `da7dd8c84` in [37354212913](https://github.com/tandavkrishna27/AoA/actions/runs/37354212913). Earlier `e43d503c7` artifacts also confirm worker-owned events, usage/cost/audit, tenant separation, rollback and negative controls |
| Tenant separation and usage/budget/audit | Real-Postgres suites; spine and required fault cases | Pending current-revision run |
| Fence, cancel, recovery and redaction | Worker suites; required D1 fault cases and negative controls | Enrollment replay after hello refresh: 41 real-Postgres tests passed; immediate provider rejection and cancel/create regressions: 4 passed. New early live-restart case is required and awaits its D1 run |
| Source-built boot and real E2B mechanism | Existing shipped-boot keyless, then named keyed test on the tested SHA | Keyless [37356828601](https://github.com/tandavkrishna27/AoA/actions/runs/37356828601) passed on integration `17be6bc0f`. Keyed [37359163188](https://github.com/tandavkrishna27/AoA/actions/runs/37359163188) is running on the same revision |
| Cleanup and rollback | Drain tests; actual Compose/provider cleanup observations | Current keyless Compose cleanup passed; real-provider cleanup pending |

The existing commands and workflows are the implementation tests. Their
test-root image-integrity checks and ordinary retained diagnostics suffice for
this internal milestone; separate production-root approval and long-term archive
certification are not required. Keep runtime checks intact and fix real failures.
Declared pending cases and platform skips must be reported as such.

Local checks ran in `codex/m1-code-tests`, based on integration
`a770c1145d4cbd049fac0f75063dfaa2c660300e`. The branch repairs the D1 ACK client,
the shipped-boot ancestry check, the transferred MinIO package namespace,
runner disk exhaustion, and worker enrollment replay after an authorized hello
refresh. Regression tests and these process docs accompany those changes.
The ACK client retries protocol-declared backpressure up to four times, retaining
its semantic payload and idempotency key, refreshing device proofs, and respecting
the server's ACK deadline. Production locks and timeouts are unchanged.
The workflow suite passed 66 tests; the D1 Compose suite passed 61 tests.
MinIO's digest remains unchanged: registry metadata resolves that digest under
`tandavkrishna27`, while its former `meteoritelabs` namespace returns
`manifest unknown`.

The production replay fix retains the original enrollment request's semantic
digest, device proof, identity, generation, company/organization authority and
original expiry checks. A replay signs the worker's current authorized profile
instead of incorrectly requiring the pre-refresh profile. It does not restore
old capabilities or extend the code's ten-minute lifetime. Cold restart after
that original expiry still requires operator re-enrollment; the separate late
restart test must continue to refuse with `401` and idle.

The new early restart test hard-kills a genuinely running worker with a durable
lease candidate while its original enrollment code is live, observes that exact
lease's startup fence and natural reaping, then requires the same worker to
execute fresh work. Live success is not yet claimed. Secret-reader company
isolation also passed 27 explicitly enabled Postgres tests; those are direct
service tests, not a claim that the pending real-provider variants ran.

Run diagnostics: the first keyless attempt
[37347607649](https://github.com/tandavkrishna27/AoA/actions/runs/37347607649)
failed on the redundant unauthenticated fetch (fixed). The first D1 attempt
[37347848182](https://github.com/tandavkrishna27/AoA/actions/runs/37347848182)
was cancelled before bring-up when the stale image namespace was confirmed.
Neither attempt reached functional tests. The CI status reporter was refreshed
by [37349221648 attempt 2](https://github.com/tandavkrishna27/AoA/actions/runs/37349221648/attempts/2)
after a transient GitHub API 500; its first failure is retained in Actions.

The six explicitly enabled Windows Postgres suites were `job-leasing`,
`job-fencing`, `job-events`, `job-accepted-event-seam`, `job-distributed-drain`,
and `m1-cleanup-sql` (`AOA_RUN_WIN_INTEGRATION=1`, two workers).
The shipped-boot workflow requires an integration-branch ancestor, so its run
uses the integration revision named above. D1 must separately exercise the new
ACK test client on the feature revision; these are distinct tested revisions.

```sh
pnpm -r typecheck
pnpm test:run
pnpm build
gh workflow run d1-merge-train.yml --ref <tested-ref> -f lanes=all -f campaign=foundation
gh workflow run m1-shipped-boot.yml --ref <tested-ref> -f candidate=<tested-sha> -f mode=keyless
```

Use the existing named real-E2B mechanism test and its template configuration
after the keyless boot succeeds. Inspect each failure before another attempt.
M1a completion means the required functional checks above passed at the recorded
revision. The historical a2/a23 `fail` records remain accurate under their old
criteria and are not edited or relabelled.

## Next: M1b

After M1a passes, finish CLI-018 founder access to produced bytes, CLI-015's
verifier, and the remaining output/tool acceptance tests. Reuse the output,
usage, audit and artifact-export implementations already present. M1b completes
through tested useful behavior under the same founder amendment, without an
additional certification process.

M1b implementation is prepared separately in `codex/m1b-outputs` while the live
M1a checks finish. It adds authenticated founder downloads, a bounded verifier
with job-wide leak scanning, actual MCP route tests, and an optional useful-work
phase in the existing shipped-boot workflow. The phase is off by default and
keyed-only: after M1a's checks, it temporarily arms tools for tenant A, asks the
agent to read a random reference task through MCP, then downloads and hashes its
committed JSON output. B stays tool-disabled and C stays absent from the rollout.
The temporary public test connection exposes only authenticated MCP POSTs and
is stopped on success or failure. It is CI test infrastructure, not product ingress.

Local M1b typecheck and build passed again after the focused edge-case fixes.
The final full suite passed 2,444 files / 23,543 tests (222 files / 1,861 tests
skipped). The explicit Windows PostgreSQL/backend/verifier run passed
224 tests with zero skips, the actual MCP route suite passed 8, the viewer suite
passed 17, and workflow/driver/network tests passed 181. Live useful-work and
actual Linux tunnel startup remain outstanding. These are preparation results,
not a claim that M1a or M1b is complete.

## Historical September 26 recovery instructions

The sections below preserve the former sequence for context. Their separate
freeze, certification and handoff prerequisites were superseded on October 5.

### Former authority and boundaries

Execute the approved [M1 plan](../../qa/2026-09-21-m1-execution-plan.md),
[recovery procedure](../../epic-regrooming/qa-handoff-recovery.md), and E5-D09.
The latest milestone handoff remains attempt 2, `Decision: fail`. Historic records
are not rewritten. M1b entry remains gated. DE-08/H-06, full D1/D2, epic completion,
and useful capability remain explicitly uncertified.

PR #620 repaired the D1 redaction evidence at implementation head
`ea3cdca9323fb74a6dc54c41633ac071b59bdb3a`, merged as
`583b5fc8d596edbbb39b88b7329cb2dfb3979295`. Independent review found no blocking
findings; all 16 exact-head CI checks passed. That establishes source repair, not
milestone closure.

## Ordered work and acceptance

1. Commit the distinct review disposition for DEP-027. Its result must be
   `complete` before it is pinned as accepted successor evidence.
2. Record the exact candidate before dispatch, with all thirteen required M1a
   ticket-result blobs (including DEP-019), DEP-027 successor blob, matrix blob,
   topology/configuration/feature-flag digests, protocol/provider/template versions,
   external services, owners and rollback path. Independently review this record.
3. Obtain post-freeze exact-candidate D1 evidence, including all three jobs,
   artifact-only grading, and suppressed-injection negative controls. In particular,
   the planted canary must be scrubbed and the credential-free inert control must
   appear verbatim on both nonce-scoped streams.
4. Run the keyless shipped-boot preflight on the named candidate. Check no equivalent
   keyed run is active or complete, then dispatch one fresh M1a-D2-MECHANISM campaign
   under the existing F8 named authorization. No other paid campaign is authorized
   by this plan. Failure requires diagnosis before any additional paid dispatch.
5. Commit superseding exact-candidate campaign QA records after independently
   reviewing retained artifacts: D1 attempt 19 and mechanism attempt 26, provided
   those remain the next available immutable ordinals.
6. Author E5 audit attempt 4, explicitly M1a under E5-D09, superseding attempt 3.
   Pin the committed new campaign-record blobs and grade all seven frozen clauses.
7. Obtain separate certification from an eligible independent session. A committed
   audit cannot be edited to add a certification; use a separate attributable
   certification artifact or higher superseding attempt according to artifact policy.
8. Only after certified passing evidence, prepare the higher M1a handoff superseding
   attempt 2. Pin all thirteen required results plus DEP-027, both new campaigns and
   the certified audit. This remains non-promoting. Then audit M1b gaps.

## Roles

| Role | Session |
|---|---|
| Planning, partial-gate/rollback owner, campaign dispatcher, handoff decision | Calling M1 planning session under founder F2 delegation |
| DEP-027 implementer | `01a0dd9c-ec6d-7b12-a26a-f3e9783d4506` |
| Independent implementation reviewer, campaign QA record author, E5 audit author | `01a0dd9b-ba6d-79a2-8d96-9651bf242b4e` |
| Reserved independent E5 audit certifier | `01a0de6b-915c-7fb0-b3d7-59e7bac3dc95` |

The certifier must take no relied-on decision, implement no repair, dispatch no
campaign, author no campaign QA record/audit, and prepare no milestone handoff.
Reservation is not certification; actual evidence review is still required.

## Automatic-run timing

Push-triggered D1 run `36253363996` started on merge `583b5fc8...` before this
replacement freeze was recorded. It is diagnostic evidence, not a conforming
post-freeze campaign. Do not backdate the freeze or count this run as the final
milestone evidence. Retain its artifacts, avoid a simultaneous duplicate, and run
the free D1 campaign after the conforming freeze. A later code/configuration change
requires a new candidate; documentation-only disposition carry-forward requires
explicit byte-identity proof.

## Verification

Before dispatch: clean candidate, integration ancestry, independent disposition,
complete blob/configuration inventory, declaration/finding/citation/ticket guards,
and immutable-history guard. Campaign verdicts must be measured, never inferred
from ordinary PR CI. No `pass` record may be prepared while a required run is
unfinished or its retained evidence has not been reviewed.
