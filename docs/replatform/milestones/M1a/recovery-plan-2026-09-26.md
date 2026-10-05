# M1a direct code-and-test checklist

**Updated:** `2026-10-05`
**Integration branch:** `docs/replatform-program`
**Status:** implementation and testing in progress

## Current acceptance

The [October 5 founder amendment](../../test-gates.md#m1-code-and-test-acceptance--founder-amendment-2026-10-05)
replaces the former certification process for M1a and M1b. Complete M1a with
working code and meaningful tests, then proceed to M1b. Record the tested SHA
and results here; no additional certificate, archive, freeze or handoff is owed.

| Behavior | Executable check | Current result |
|---|---|---|
| Repository compiles and builds | `pnpm -r typecheck`; `pnpm build` | Both passed locally, October 5 |
| Existing product regressions | `pnpm test:run --maxWorkers=4` | 23,499 passed; 1,831 skipped. Skips remain unproven |
| Concurrent leasing and ACK | Lease integration tests; live D1 lease races | Six real-Postgres suites passed (113 tests); ACK and adjacent regression suites passed (25 tests). Live D1 [37347848182](https://github.com/tandavkrishna27/AoA/actions/runs/37347848182) running on `b1e963aa3` |
| Worker owns distributed execution | Live `m1-spine`, including the wrong-executor control | Pending current-revision run |
| Tenant separation and usage/budget/audit | Real-Postgres suites; spine and required fault cases | Pending current-revision run |
| Fence, cancel, recovery and redaction | Worker suites; required D1 fault cases and negative controls | Pending current-revision run |
| Source-built boot and real E2B mechanism | Existing shipped-boot keyless, then named keyed test on the tested SHA | Keyless [37347607649](https://github.com/tandavkrishna27/AoA/actions/runs/37347607649) failed before build: redundant unauthenticated Git fetch after checkout. Workflow repair in progress; keyed pending |
| Cleanup and rollback | Drain tests; actual Compose/provider cleanup observations | Pending current-revision run |

The existing commands and workflows are the implementation tests. Their
test-root image-integrity checks and ordinary retained diagnostics suffice for
this internal milestone; separate production-root approval and long-term archive
certification are not required. Keep runtime checks intact and fix real failures.
Declared pending cases and platform skips must be reported as such.

Local checks ran in `codex/m1-code-tests`, based on integration
`a770c1145d4cbd049fac0f75063dfaa2c660300e`. The branch changes the D1 ACK client
and its regression tests, plus these process docs; production source is unchanged.
The ACK client retries protocol-declared backpressure up to four times, retaining
its semantic payload and idempotency key, refreshing device proofs, and respecting
the server's ACK deadline. Production locks and timeouts are unchanged.

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
