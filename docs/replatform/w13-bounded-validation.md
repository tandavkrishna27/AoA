# W13 bounded service and authenticated realtime validation

> **Implementation scope (19 October 2026):** Keep the bounded functional tests
> below. FULL quantitative realtime repetitions and long-form D4 collection are
> deferred; do not run those campaign sections or provision resources for them.
> See the [current test policy](../aoa/plans/2026-10-19-implementation-test-policy.md).

These engineering checks do not close W13, D4, COV-01, or D5. Run them against
one recorded candidate in a fresh checkout. Use Node 24.19.0 and pnpm 9.15.4;
install the checked-in lockfile with `pnpm install --frozen-lockfile`. Build the
package export required by the daemon and socket source imports:

```sh
pnpm --filter @armyofagents/worker-protocol build
node --test scripts/lib/__tests__/availability-measurements.test.mjs scripts/lib/__tests__/d4-service-availability.test.mjs
pnpm exec vitest run packages/worker-daemon/src/__tests__/service-native-process.test.ts packages/worker-daemon/src/__tests__/svc-008b-service-supervisor.test.ts packages/worker-daemon/src/__tests__/service-checkpoint-stage-before-start.test.ts server/src/__tests__/live-events-broker.test.ts --maxWorkers=1 --minWorkers=1
```

The native-process test runs the shipped supervisor over actual Node child
processes, real elapsed time, process-exit observations, and immutable JSON bytes.
It exercises crash/restart, same-generation verified checkpoint staging before
launch, a subsequent generation after the old process exited, and an elapsed
run-budget stop. Sandbox identity and staging use the existing test provider;
the export sink saves real bytes locally and returns no invented artifact commit.
This is not a paid-provider journey, production service reconciliation, a database
generation rollout, or the company spending-budget gate. Those acceptance rows
remain pending. Existing service generation/checkpoint/crash-recovery integrations
cover their separate database contracts; they must not be called provider proof.

## Actual socket composition on either local Windows or a Linux VPS

The self-contained Node test starts one temporary real embedded PostgreSQL
cluster, applies the committed migrations, and starts two **separate processes**
using the shipped authenticated socket server, durable store, LISTEN broker and
poll drainer. It binds only loopback ephemeral ports. No existing application,
database, Docker service, provider account or fixed port is required. Linux must
run as a normal user because PostgreSQL `initdb` refuses root. The migrated boot
fixture uses an owner pool; this is not a production non-owner/RLS certificate.

Create a fresh evidence directory outside Git, with its own HOME and TEMP. Keep
the toolchain on PATH and supply no provider credentials. On Linux:

```sh
mkdir -p "$EVIDENCE/home" "$EVIDENCE/tmp"
env -i PATH="$PATH" HOME="$EVIDENCE/home" TMPDIR="$EVIDENCE/tmp" \
  AOA_W13_REALTIME=1 AOA_W13_CANDIDATE="$(git rev-parse HEAD)" \
  AOA_W13_REPORT="$EVIDENCE/realtime-smoke.json" \
  node --import tsx --test --test-concurrency=1 tests/d1/w13-authenticated-realtime.test.mjs \
  >"$EVIDENCE/realtime-smoke.log" 2>&1
```

On Windows PowerShell, set `HOME`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`,
`TEMP` and `TMP` to dedicated directories under the evidence directory; keep
Windows system variables and the pinned Node directory on PATH:

```powershell
$env:AOA_W13_REALTIME = '1'
$env:AOA_W13_CANDIDATE = git rev-parse HEAD
$env:AOA_W13_REPORT = "$evidence/realtime-smoke.json"
node --import tsx --test --test-concurrency=1 tests/d1/w13-authenticated-realtime.test.mjs
```

Smoke is exactly 200 initial durable events over two organizations, five
reconnect gaps, five duplicate transport injections, and a 250 ms broker outage.
Both listeners **and** safety polls stop during the outage. Twenty writes are
committed through the shipped store while wakes are withheld. Recovery must
deliver every accepted event within five minutes. Additional probes use a real
paused TCP reader and 16 MiB of persisted hints to reach native backpressure,
then require the snapshot-resume control frame. A real retention trim separately
requires snapshot fallback. The test also requires cross-tenant/invalid-key HTTP
403, same-company private/foreign thread subscription and live/replay denial,
authorized positive controls, durable order, and token canaries absent from
socket frames and denial audit details.
Before publishing hidden thread events, the child waits for the genuine
subscription authorizer's private-thread discussion/participant queries, the
foreign-thread empty discussion query, and the public-thread discussion/participant
queries to complete, then drains their remaining Promise continuations. The raw
ledger retains those completed query receipts. This test-only observer delegates
all database queries and values unchanged; it uses no timed sleep as a barrier.

### Full quantitative realtime — DEFERRED

Do not run this lane during implementation. The retained commands preserve the
normative counts and duration for later qualification:

```sh
env -i PATH="$PATH" HOME="$EVIDENCE/home" TMPDIR="$EVIDENCE/tmp" \
  AOA_W13_REALTIME=1 AOA_W13_REALTIME_FULL=1 \
  AOA_W13_CANDIDATE="$(git rev-parse HEAD)" \
  AOA_W13_REPORT="$EVIDENCE/realtime-full.json" \
  node --import tsx --test --test-concurrency=1 tests/d1/w13-authenticated-realtime.test.mjs \
  >"$EVIDENCE/realtime-full.log" 2>&1
```

On Windows add `$env:AOA_W13_REALTIME_FULL='1'` and use a new report filename.
Full mode requires 10,000 initial durable events, 100 reconnect gaps, 100 duplicate
injections and a literal 900,000 ms outage. The outer test budget is explicitly
900,000 ms outage + 300,000 ms maximum catchup + 600,000 ms bounded startup and
workload allowance (30 minutes total). This runner allowance does not extend the
15-minute fault or five-minute catchup acceptance limits. A smaller
smoke result cannot close this lane. Do not change the normative constants to
make a run finish sooner. The report and `.raw.json` ledger use exclusive create;
each new attempt needs new paths. The ledger retains accepted event identities,
socket delivery sequences/event identities/payload hashes and actual native
buffer depths. Reports record candidate, wall-clock timestamps and scope limits.
`AOA_W13_REALTIME_EVIDENCE` is an alias for the report **filename** and takes
precedence over `AOA_W13_REPORT`; its parent directory must already exist.

## Frozen service availability schedule — live collection DEFERRED

Do not run live collection during implementation. Offline schedule/verdict
checks remain active; the campaign commands below are for later qualification.

`scripts/d4-service-availability.mjs` implements the shared SLI schedule,
collection and independently recomputable verdict. It does not orchestrate the
full D4 fault schedule or invent provider probes. Prepare an input JSON with
`campaignId`, exact `candidate`, `timezone: "UTC"`, minute-aligned `start`/`end`,
`workloadSlosMs: { "service": 60000 }`, and a `dimensions` array containing
`organizationId`, `workload: "service"`, `target`, `provider`, and `revision`
equal to the candidate. For full D4 choose at least 72 consecutive hours.
Optionally declare the only permitted exclusions in `scheduledExclusions`:

```json
[
  { "faultId": "partition", "kind": "worker_control_plane_partition", "scheduledAt": "2026-11-01T01:00:00.000Z", "durationMs": 900000 },
  { "faultId": "provider", "kind": "provider_pause_or_forced_outage", "scheduledAt": "2026-11-01T02:00:00.000Z", "durationMs": 900000 }
]
```

The CLI stamps actual freeze time, generates every expected UTC minute/cohort,
hashes the full manifest, and refuses overwrite. Commit the manifest before
start; retain its commit identity separately. Collection must start before the
frozen start. Suppressed minutes are never backfilled or removed.

```sh
node scripts/d4-service-availability.mjs freeze input.json manifest.json
node scripts/d4-service-availability.mjs collect manifest.json samples.ndjson actual-runtime-probe.mjs
node scripts/d4-service-availability.mjs evaluate manifest.json samples.ndjson report.json actual-faults.json
```

The probe is a local Node adapter supplied for the actual service environment.
It receives one expected sample plus the separate `driverStartedAt` timestamp on stdin and
must return one JSON object, without diagnostics, on stdout. A successful result
must record `success`, `reason`, `telemetryComplete`, `durableSuccess`,
`authorizedReadback`, actual operation `submittedAt` and `readbackAt`, `fencedInstanceCount: 1`, current
`healthCurrent`, and matching nonempty `generation`/`desiredGeneration`. The
adapter must actually inspect the authoritative fence and process-observation
health, submit the synthetic operation and perform authorized durable readback.
No health-endpoint-only adapter is provided as an acceptance shortcut. The adapter
must measure submission when the synthetic operation is actually submitted after
any setup. Driver process launch never substitutes for that timestamp. Collection
pins frozen identity/dimensions, driver launch time and observation time, and
preserves the adapter's actual submission time. Missing, malformed, backdated or
future submission evidence fails closed; successful chronology requires
`driverStartedAt <= submittedAt <= readbackAt <= observedAt`. The actual operation
must be submitted in its scheduled minute and reach readback within the unchanged
60-second SLO. An adapter launched in one minute whose operation starts in the
next minute is a failed scheduled sample even if readback is fast.
The adapter process collection deadline is the end of the scheduled submission
minute plus the actual-operation 60-second readback window plus five seconds
for local result reporting. This bounded collection allowance does not extend
either the scheduled submission minute or the actual-operation SLO. For example,
five seconds of setup followed by 56 seconds to readback remains eligible; an
actual-operation duration of 60,001 ms fails. Scheduled probes launch independently
while a previous adapter is still collecting, and raw writes remain serialized;
a valid long readback cannot silently suppress the next expected minute.
Adapter timeout, exit failure, malformed JSON or output overflow is failed raw
evidence. Raw records are flushed to disk per sample.

If exclusions were scheduled, evaluation requires actual observations with
`faultId`, `effectiveAt`, and `removedAt`, exactly fifteen minutes apart. Samples
in the half-open effective/removal interval are excluded from the availability
denominator. Missing evidence even inside an exclusion fails SLI-04. Restart,
drain, generation update, restore, budget/TTL stop and recovery remain normal
samples. Unscheduled, widened, duplicate and overlapping exclusions fail closed.

Reports retain expected/observed/missing, numerator/denominator, exclusion counts
and reasons, conflicts, and each exact dimension cohort. Missing dimensions,
timestamps, source telemetry or contradictory duplicate reports fail evidence
integrity even when the numeric aggregate is at least 99.5%. Late readback is a
failed normal sample. Identical duplicates do not inflate counts. The fixed
99.5% threshold also applies to every declared cohort. The shared helper accepts
D6 dimensions and rejects D6 exclusions, but W18 still owns its complete
workload/support-row campaign aggregation and scheduling acceptance.

Full D4 still requires independently recorded duration/fault execution,
single-authority/post-fence/health invariants, immutable checkpoint identity,
control-plane convergence within two minutes, worker/provider recovery within
ten minutes and zero final resources. Every SLI report explicitly states
`fullD4Acceptance: false`.
