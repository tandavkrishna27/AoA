# Implementation-phase test policy — 19 October 2026

The founder has deferred performance optimization. Performance-only failures are
non-blocking for current implementation work, and performance campaigns are
unnecessary now. Do not run them or recreate local/VPS installations for them.
Resume only when the founder brings optimization or release qualification back
into scope. This supersedes earlier instructions to keep pursuing W11 load
failures or rerun quantitative campaigns during implementation.

Use targeted functional tests for changed behavior. Leave the full suite to
GitHub CI. Keep job completion, durable output, accepted-work recovery, tenant
isolation, authorization, lease/fence ownership, quota and spend accounting,
cancellation and teardown checks active. Do not relax correctness assertions or
test watchdogs to obtain a pass. A correctness failure observed under load is
still a correctness failure; only throughput, capacity targets, fairness ratios,
latency ceilings and long quantitative qualification are deferred.

## Deferred inventory

| Test or command | Current disposition | Existing/manual opt-in |
|---|---|---|
| `server/src/__tests__/performance-qa.test.ts` | Skip by default. Local literals/formulas and two micro-timing assertions do not test product implementation or certify real performance. | `AOA_RUN_PERFORMANCE_QA=1` |
| Import-time ceilings in `routines-routes-contract.test.ts` and `teams-routes-contract.test.ts` | Skip the three-second optimization assertion by default; keep import completion, factory and endpoint contracts. | `AOA_RUN_PERFORMANCE_QA=1` on non-Windows hosts |
| `scripts/m4-daemon-load.mjs` live prepare/run and `scripts/m4-local-load.mjs` | Defer W11 baseline/loaded/fairness campaigns and further profiling. Existing captures remain available for offline review. | Manual CLI, `AOA_D1_LIVE=1` and an owned disposable Compose project for live runs |
| `server/src/__tests__/job-leasing-load.integration.test.ts` million-row lane / `scripts/run-e3-perf-01.mjs` | Defer seeding, repeated SQL/EXPLAIN timings, index-size and throughput campaign. The runner explicitly enables the lane; do not invoke it now. | `AOA_RUN_E3_PERF_01=1` and the dedicated database; the runner sets this flag itself |
| `tests/d1/w13-authenticated-realtime.test.mjs` FULL variant | Defer 10,000-event / 100-reconnect / 15-minute outage quantitative repetition. | `AOA_W13_REALTIME=1` plus `AOA_W13_REALTIME_FULL=1` |
| `scripts/d4-service-availability.mjs collect`, full D4/D5/D6 load/soak qualification | Defer long-form collection and quantitative release campaigns. Offline freeze/evaluation and their correctness tests remain usable. | Explicit manual campaign command/schedule; not invoked by routine PR CI |

These existing campaigns were already opt-in. No workflow sets the full W13 or
E3 performance flags or invokes the live W11/D4 campaign drivers. Do not add
those invocations to routine CI. `AOA_D1_LIVE` is also used by functional D1
checks, so it is not a global performance switch.

## Checks that remain active

- The five cheap, DB-free E3 immutable contract cases, including the complete
  lease-certificate anti-join authority tuple, remain in the ordinary test lane.
- The bounded W13 smoke selected in PR CI remains: authenticated delivery,
  duplicate/reconnect handling, stop barriers, outage recovery, backpressure,
  tenant/thread access control and credential containment. Leave FULL unset.
- Offline W11/W13 measurement and driver tests remain. They verify request
  accounting, missing/late evidence, schedule validity, fixture ownership and
  verdict arithmetic; running them does not launch a load campaign.
- Race, retry, deadline, cancellation and shutdown tests remain. Counts and
  timeouts used to prove single ownership, finite termination or accepted-work
  recovery are functional contracts, not reasons to disable a test.

## Results and checklist disposition

The [19 October W11/Windows report](../reports/2026-10-19-w11-windows-followup.md)
retains both final baseline PASS results and both loaded/comparison FAIL results.
Default quiet completion was 25/30, with throughput ratio 0.642857 and queue-p95
ratio 3.901124; historical64 was 30/30, with ratios 0.758621 and 3.451630. These
missed load/fairness targets are **DEFERRED — optimization phase**, not current
implementation blockers. The cause of the residual contention is not established.
Do not repeat profiles to improve these numbers during this phase.

Existing functional passes remain qualified to their recorded candidates. This
policy does not claim new product passes, close all W11/W13/W17 release exits,
or erase functional work still open in the [handoff](2026-10-18-w11-w13-w17-handoff.md).
Raw historical verdicts and thresholds remain unchanged; formal release
qualification stays outstanding for its later phase.

## Verification of this policy change

Node 24 syntax checks pass for all three changed test files. A dependency-free
module-registration check confirms the 27 Performance QA cases are skipped
with the flag unset or `0` and enabled only with `1`; it executes no test bodies
and is not a Vitest run. The two existing offline measurement test files pass
52 tests with zero failures/skips. Full Vitest, build and live campaigns were
not run: dependency installations had already been removed, and this scoped
test-policy change does not justify restoring applications or dependencies.
CI remains responsible for the actual Vitest route-contract execution.
