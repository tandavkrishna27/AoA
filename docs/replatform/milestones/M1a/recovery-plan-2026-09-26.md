# M1a direct code-and-test checklist

**Updated:** `2026-10-06`
**Integration branch:** `docs/replatform-program`
**Status:** M1a passed; M1b fixes pass locally and await the next live useful-work run

PRs [#646](https://github.com/tandavkrishna27/AoA/pull/646) and
[#645](https://github.com/tandavkrishna27/AoA/pull/645) are merged. The current
integration revision is `9925e8d877dfb3587211f0197cd69c5b5ec3302e`.
Required CI passed for #646 at `232d15298db0e459e147b0062110f3457b7ec46f` in
[37372575453](https://github.com/tandavkrishna27/AoA/actions/runs/37372575453),
and for #645 at `94f9542cddf08fa66fbd64286eab44287b65b1c8` in
[37365938714 attempt 4](https://github.com/tandavkrishna27/AoA/actions/runs/37365938714/attempts/4).
Combined keyed shipped-boot run
[37378134451](https://github.com/tandavkrishna27/AoA/actions/runs/37378134451)
used the exact merged revision with `m1b=true`. M1a's real-E2B mechanism,
required controls and shared cleanup passed. M1b's useful-work check failed:
the agent completed without an observed MCP read or exported output. M1a is
complete under the founder amendment; M1b remains in progress.

Earlier PR [#644](https://github.com/tandavkrishna27/AoA/pull/644) merged into this
integration branch at `17be6bc0f92d66b95020971a6b7d2df83fc59b88`. Its required
CI passed in [37354192434](https://github.com/tandavkrishna27/AoA/actions/runs/37354192434).
The merge has the same file tree as tested branch head
`da7dd8c84770558039881777a069235053b2f072`. D1 run
[37354212913](https://github.com/tandavkrishna27/AoA/actions/runs/37354212913)
passed core, spine and the early worker restart. Its matrix failed the late
expiry control: the fixture allowed two hours, while the test assumed ten
minutes. The suppressed matrix therefore did not run.

Correction PR [#646](https://github.com/tandavkrishna27/AoA/pull/646), merged head
`232d15298db0e459e147b0062110f3457b7ec46f`, gives that control its own short-lived
enrollment fixture, closes leaked test database pools, removes a test helper's
manual lease release, and lets a worker offer its next slot after an attempt is
terminal. Active leases, fences and organization quota claims retain their
normal lifecycle. The final cleanup check waits for the existing reaper rather
than taking a premature one-shot inventory. Its earlier `0d7e7634b` local
typecheck and build passed; the full suite passed 2,444 files / 23,500 tests,
with 222 files / 1,835 tests skipped. The actual PostgreSQL leasing suite passed
all 42 tests. The first corrected D1 matrix
[37364667404](https://github.com/tandavkrishna27/AoA/actions/runs/37364667404)
failed because its fresh worker fixture did not become healthy. Follow-up
`f29e51e5017d4e3dd0b239d9490cd191a9f5f7bd` repaired fixture environment and
private fixture ownership. D1 matrix
[37368392926](https://github.com/tandavkrishna27/AoA/actions/runs/37368392926)
then passed all 26 normal tests with zero skips, its retained-bundle verdict,
the suppressed-injection negative control and teardown. Core and spine were
skipped by that run's matrix-only campaign selection. These D1 test and harness
files are unchanged in `9925e8d87`; this is a run on `f29e51e50`, not a separate
live D1 run on the final merged revision.

Updated-candidate keyless boot
[37356828601](https://github.com/tandavkrishna27/AoA/actions/runs/37356828601)
passed on `17be6bc0f`: all three source-built image revisions match, all 14
tenant/refusal cases fired with successful own-tenant controls, the suppressed
arm refused all 14 missing injections, and cleanup readback found no remaining
containers, networks or volumes. The control task stayed legacy with zero
distributed jobs; its missing local Claude executable is an expected keyless
control outcome, not a successful model task. Real-E2B run
[37359163188](https://github.com/tandavkrishna27/AoA/actions/runs/37359163188)
failed its final database inventory on that same integration revision. Both
enabled model tasks succeeded with accepted lifecycle, usage, cost and activity
records; the control tenant created zero distributed jobs. All 17 required
mechanism cases fired, while nine additional cases remain pending. Both
redaction arms and the 14 suppressed tenant/refusal controls behaved as expected.
All four inventoried E2B sandboxes were independently confirmed deleted, and
Compose cleanup passed. The remaining failure was two synthetic redaction jobs
still marked nonterminal: the manual lease release prevented one from reaping,
and the last job was inspected before its lease expired. PR #646 addresses those
causes. This run does not establish complete M1a acceptance.

## Current acceptance

The [October 5 founder amendment](../../test-gates.md#m1-code-and-test-acceptance--founder-amendment-2026-10-05)
replaces the former certification process for M1a and M1b. Complete M1a with
working code and meaningful tests, then proceed to M1b. Record the tested SHA
and results here; no additional certificate, archive, freeze or handoff is owed.

| Behavior | Executable check | Current result |
|---|---|---|
| Repository compiles and builds | `pnpm -r typecheck`; `pnpm build` | Both passed locally on exact merged `9925e8d87` |
| Existing product regressions | `pnpm test:run --maxWorkers=4` | Exact merged `9925e8d87`: 2,444 files / 23,543 tests passed; 222 files / 1,867 tests skipped. Skips remain unproven |
| Concurrent leasing and ACK | Lease integration tests; live D1 lease races | Six real-Postgres suites passed (113 tests); ACK and adjacent regression suites passed (25 tests). Core D1 passed on `da7dd8c84` in [37354212913](https://github.com/tandavkrishna27/AoA/actions/runs/37354212913) |
| Worker owns distributed execution | Live `m1-spine`, including the wrong-executor control | Passed on `da7dd8c84` in [37354212913](https://github.com/tandavkrishna27/AoA/actions/runs/37354212913). Earlier `e43d503c7` artifacts also confirm worker-owned events, usage/cost/audit, tenant separation, rollback and negative controls |
| Tenant separation and usage/budget/audit | Real-Postgres suites; spine and required fault cases | Merged keyed `9925e8d87`: A/B real model tasks succeeded with applied lifecycle, cost and audit receipts; C created no distributed jobs; all 14 hostile cases and their own-tenant controls passed |
| Fence, cancel, recovery and redaction | Worker suites; required D1 fault cases and negative controls | Corrected D1 early restart, late-expiry refusal, cancellation and suppressed control passed on `f29e51e50`; merged keyed `9925e8d87` passed both real redaction arms and detected all 14 suppressed injections |
| Source-built boot and real E2B mechanism | Existing shipped-boot keyless, then named keyed test on the tested SHA | Combined run `37378134451` on `9925e8d87`: three source-built image labels match; independent grading found all 17 required cases fired and zero violations. Nine declared variants remain pending |
| Cleanup and rollback | Drain tests; actual Compose/provider cleanup observations | Merged keyed `9925e8d87`: all five bound jobs/attempts succeeded and leases released; five provider create/kill pairs matched, all IDs absent and complete live list empty; Compose containers, networks and volumes independently empty |

The exact merged local suite completed in 289.68 seconds. Its logs are
`aoa-m1-9925-typecheck.log`, `aoa-m1-9925-build.log` and
`aoa-m1-9925-suite.log` in the local temporary directory.

The existing commands and workflows are the implementation tests. Their
test-root image-integrity checks and ordinary retained diagnostics suffice for
this internal milestone; separate production-root approval and long-term archive
certification are not required. Keep runtime checks intact and fix real failures.
Declared pending cases and platform skips must be reported as such.

Open PRs [#635](https://github.com/tandavkrishna27/AoA/pull/635) and
[#637](https://github.com/tandavkrishna27/AoA/pull/637) contain unmerged campaign
gateway/journal and private holder-store infrastructure. They have no product or
shipped-boot callers and are optional future operational hardening, not M1a or
M1b prerequisites under the amendment. Their unique code is not claimed merged.

The current D1 profile declares 31 cases, of which 30 are required; the
production credential-reader company-predicate case remains pending in that
profile. The 27 Postgres service tests below provide separate company-isolation
coverage. The real-E2B mechanism profile still has nine declared pending variants;
separately observed redaction and sandbox deletion do not relabel them as run.
The environment probes reached the metadata address with HTTP 401; the existing
DE-08 residual remains and H-06 is not passed. Internal M1a acceptance does not
claim full D0-D6 or production qualification.
The optional M1b useful-work phase does not execute the full D2 coding campaign.

Earlier implementation checks ran in `codex/m1-code-tests`, based on integration
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
old capabilities or extend the production code's ten-minute lifetime (the D1
general fixture explicitly uses two hours). Cold restart after
that original expiry still requires operator re-enrollment; the separate late
restart test must continue to refuse with `401` and idle.

The new early restart test hard-kills a genuinely running worker with a durable
lease candidate while its original enrollment code is live, observes that exact
lease's startup fence and natural reaping, then requires the same worker to
execute fresh work. That early test passed in D1 run `37354212913` in about
7 minutes 48 seconds. Secret-reader company
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
The shipped-boot workflow requires an integration-branch ancestor. Its current
combined run uses `9925e8d87`; the successful corrected D1 matrix used
`f29e51e50`. Keep these tested revisions distinct.

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

## M1b implementation and live check

CLI-018 founder access to produced bytes, CLI-015's verifier and the useful-work
output/tool checks are now implemented and merged in PR #645. M1b live acceptance
follows successful M1a steps in the combined run. It completes through tested
useful behavior under the same founder amendment, without an additional
certification process.

The merged M1b implementation adds authenticated founder downloads, a bounded verifier
with job-wide leak scanning, actual MCP route tests, and an optional useful-work
phase in the existing shipped-boot workflow. The phase is off by default and
keyed-only: after M1a's checks, it temporarily arms tools for tenant A, asks the
agent to read a random reference task through MCP, observes the successful
task-context response, then downloads and hashes its committed JSON output.
The observation retains only company/task IDs and a title hash. B stays
tool-disabled and C stays absent from the rollout.
The temporary public test connection exposes only authenticated MCP POSTs and
is stopped on success or failure. It is CI test infrastructure, not product ingress.

Earlier M1b branch typecheck and build passed after the focused edge-case fixes.
That full suite passed 2,444 files / 23,543 tests (222 files / 1,861 tests
skipped). The explicit Windows PostgreSQL/backend/verifier run passed
224 tests with zero skips, the actual MCP route suite passed 8, the viewer suite
passed 17, and workflow/driver/network tests passed 181. Actual Linux tunnel
startup and shutdown subsequently passed in `37378134451`; live useful work
remains outstanding. PR #645's required CI passed at
`65b0d2105b4b9b82487e97f822e86aa4c4c5449d` in
[37360484412](https://github.com/tandavkrishna27/AoA/actions/runs/37360484412);
the additional MCP response observation passed 347 workflow/driver/network/
cleanup tests with zero skips, including real HTTP requests and private audit
file readback. Updated required CI passed at `94f9542cddf08fa66fbd64286eab44287b65b1c8`
in [37365938714 attempt 4](https://github.com/tandavkrishna27/AoA/actions/runs/37365938714/attempts/4).
The exact merged local result is recorded in the acceptance table above.

The one-turn template check
[37364872369](https://github.com/tandavkrishna27/AoA/actions/runs/37364872369)
passed on the same immutable E2B build used for the successful M1a model tasks:
`7vg8mu6gaoz2inw62lv8:5829cf46-e4e2-4a55-8855-d0535dee09d5`. The output root
started absent; the negative agent turn created no output-root or working-directory
files; both planted controls were detected. Other agent probe arms were not run.
Both sandbox termination calls were acknowledged; this small probe did not use
an independent deletion observer.

Combined keyed shipped-boot run
[37378134451](https://github.com/tandavkrishna27/AoA/actions/runs/37378134451)
ran on exact merged `9925e8d877dfb3587211f0197cd69c5b5ec3302e` with
`m1b=true`. M1a passed as recorded above. Its M1b task ran in the pinned E2B
build and returned exit 0, but observed zero MCP task reads and exported zero
files. The verifier correctly reported `capabilityProven: false`; no founder
download was possible. Shared cleanup, secret scanning and private-state purge
passed. The failed useful-work step does not invalidate the completed M1a checks.

The retained control-plane log showed tools enabled but only prompt/instructions
staged. Code inspection found that distributed MCP configuration and output-root
guidance were wrongly gated by the legacy environment's sandbox flag, which is
false in this deployment. A separate harness mismatch expected artifact kind
`run_output` while the production exporter emits `other`; it would reject a
valid export. Inspection also found that org-run agents can discover the internal
`get_heartbeat_context` tool, while the first harness prompt and observer expected
outbound `list-tasks`. The attempted `query_tasks` replacement was caught by the
real PostgreSQL discovery regression: it is excluded by the org-run allowlist.
The harness must use `get_heartbeat_context` and its actual broker
response, with a discovery-and-call regression through the real MCP route.
The follow-up fixes stage distributed context independently of legacy acquisition,
use the allowed task-context tool, and accept the exporter's actual artifact kind
while retaining all provenance checks. Typecheck and build passed; the full local
suite passed 2,444 files / 23,549 tests, with 222 files / 1,868 tests skipped.
Separately, the explicitly enabled PostgreSQL MCP suite passed all nine tests,
including actual discovery, a useful read and denial controls. The focused
context/legacy suites passed 204 tests and the Node workflow/driver/network suites
passed 190. Live useful-work success is still required.
The agent transcript was not retained, so its precise
reason for finishing without a file remains unknown.

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
