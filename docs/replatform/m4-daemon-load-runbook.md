# Bounded W11 real-daemon diagnostic

This disposable engineering fixture uses authenticated HTTP job submission, the
production placement service, two separately enrolled networked worker daemons,
and the shipped deterministic D1 provider through its gated wire. It requires no
paid provider credential. SQL creates fixture organizations, companies, agent
keys and target/enrollment authority; it never creates jobs, attempts, leases,
secret handles or placement snapshots. The existing secret service stores a dummy
company provider key under the catalog-derived name. Submission and placement
run in the built control-plane image. Production placement mints its required
owner-bound handle, and ordinary fenced redemption delivers the owned-label
capability to the networked host.

The standalone placement process initializes the trusted deployment mode and
uses the server's recognized one-shot invocation builder, with independently
established fixture company-key authority. The deterministic provider scripts
that invocation; this diagnostic does not execute capture files or prove usable
one-shot output. The existing 600-second external workload ceiling is unchanged.
The provider declares output enumeration and artifact export unsupported. The
daemon's ordinary best-effort export window therefore reports `export_artifact`
failure before emitting the scripted command terminal. This does not establish
captured-result success for COV-01 readiness, extraction or compaction. Accepted
terminal ingestion and the resulting job/lease/capacity lifecycle remain real.

Each phase has **15 seconds of fixed arrivals and an immutable 30-second drain**.
Baseline schedules 30 quiet jobs at 2/s. Loaded schedules 30 quiet jobs at 2/s and
300 noisy jobs at 20/s. Arrival launch does not wait for earlier submissions,
placement, execution or terminal upload. Missing scheduled arrivals remain job
intents. Later success never replaces a missed deadline.

The generated fixture retains the existing provider profile's **eight concurrent
operations** and the daemon's default **one batch slot**. The registered profile
comes from `docker/d1/m1-spine-worker.profile.json`; the existing migration fixture
computes/ratifies its provider digest. Only fresh identity and the source-specific
policy hash change. These are not the historical 64-slot/64-operation inputs and
cannot establish improvement over that run. Preserve the historical **3.382×
quiet-delay failure** and **102/300 noisy deadline misses**, including the later
reads showing success (`m4-code-execution.md`). No production tuning is included.

For a separate historical-capacity engineering reproduction, prepare a **fresh**
fixture with `--capacity-profile historical64`. This selects the documented
64 batch slots / 64 provider operations and two same-host control-plane replicas;
all campaign traffic still goes to replica A. It preserves 2/s and 20/s arrivals,
15+30-second timing, resources, runtime ceilings and verdict thresholds. It
neither changes existing targets nor raises the default fixture's limits.
Each historical fixture gets independent organizations, targets, enrollment
tickets and provider-profile IDs. The existing enrollment seeder computes the
canonical 64-operation digest and binds it into the fresh registered reference;
an existing target is refused before enrollment authority is created. This
requires a candidate control-plane image containing the updated seeder.

This is a capacity-matched diagnostic, not an exact replay of the unrecovered
historical overlay: the current campaign submits API `one_shot` jobs, whereas the
old real-daemon cohort used SQL-seeded `task_run` jobs. It cannot alone establish
improvement over the historical 3.382× measurement, provider qualification, HA
across failure domains, or a performance fix.

## Prepare and start (operator only)

Build the current candidate's control-plane, worker and D1 fake-provider images
using their checked-in Dockerfiles. Record the source revision, build exits and
actual image IDs/digests. Do not copy compiled output from another checkout.
Supply `AOA_D1_CONTROL_PLANE_IMAGE`, `AOA_D1_WORKER_IMAGE` and
`AOA_D1_FAKE_PROVIDER_IMAGE` with those images. The base D1 compose supplies the
PostgreSQL, MinIO, toxiproxy and test-runner dependencies.

From this checkout, with Node 24.19.0, an existing private parent directory and a
new, canonical absolute fixture path (the fixture directory must not yet exist):

```sh
node scripts/m4-daemon-load.mjs prepare /absolute/private/w11-fixture
export AOA_D1_LIVE=1
export AOA_E6F_COMPOSE_PROJECT=aoa-m4-daemon-unique-suffix
docker compose --project-name "$AOA_E6F_COMPOSE_PROJECT" \
  --env-file /absolute/private/w11-fixture/fixture.env \
  -f docker-compose.d1.yml -f /absolute/private/w11-fixture/compose.json config --quiet
docker compose --project-name "$AOA_E6F_COMPOSE_PROJECT" \
  --env-file /absolute/private/w11-fixture/fixture.env \
  -f docker-compose.d1.yml -f /absolute/private/w11-fixture/compose.json up -d --wait
node scripts/m4-daemon-load.mjs run /absolute/private/w11-fixture baseline
```

To select that independent historical cohort, replace only the preparation
command and use a new project name and absent private path for the entire run:

```sh
node scripts/m4-daemon-load.mjs prepare /absolute/private/w11-historical64 --capacity-profile historical64
```

PowerShell uses `$env:AOA_D1_LIVE='1'` and
`$env:AOA_E6F_COMPOSE_PROJECT='aoa-m4-daemon-unique-suffix'`; use the same compose
argument list. No host port is required: the driver executes submission and
observation inside the isolated control-plane service.

Preparation refuses existing paths, symlink/junction ancestors and relative
paths. Before writing any credential, it creates an owner-verified private
directory: mode 0700 on POSIX, or an inheritance-disabled Windows DACL granting
only the current user SID and SYSTEM full access, with ACL readback. Any identity
or ACL command failure aborts before private files are written.

Private input files are created exclusively with mode 0600. On Linux, arrange
ownership of the generated bind files for the containers' node UID 1000 before
bring-up (for example a scoped `chown -R 1000:1000` of the **verified exact new
fixture directory**). Keep the directory private. Do not upload
`manifest.private.json`, `fixture.env`, private signing key or enrollment tickets.
The provider receives only the public key; the control plane alone receives the
private key. Fresh worker named volumes keep identities and slot state separate.
Every generated service has the same fresh fixture UUID label. Before executing
source, the driver inspects the requested project's containers, requires their
fixture labels to match, and verifies the control-plane's exact read-only private
manifest bind. Reusing a different project's name fails closed.

Exit 1 with retained reports is an ordinary diagnostic failure. Before loaded,
wait for the baseline's scoped jobs to become terminal through the normal
production lifecycle. `run loaded` refuses prior nonterminal jobs, avoiding
baseline backlog contamination; this does not rescue the baseline verdict.

```sh
node scripts/m4-daemon-load.mjs run /absolute/private/w11-fixture loaded
node scripts/m4-daemon-load.mjs compare /absolute/private/w11-fixture
```

Run each phase once per fixture. Exclusive journals prevent overwriting old
evidence. A process or container failure retains a failed/incomplete run. Do not
restart an instrumented daemon on its existing journal; preserve evidence and
prepare a completely new fixture instead.

## Measurement and interpretation

The opt-in fetch preload fsyncs a closed start record **before calling fetch**.
The finish follows complete response-byte download through a clone; the original
body is retained for the daemon. A process lost before catch/finally leaves a
censored request in the original cohort. Submit starts and the full scheduled
job intent list are fsynced to the control-plane state volume before work.
Both the durable container journal and the independently captured host stream
are retained. Worker boot evidence must predate the phase. Missing, duplicate,
or orphan request evidence refuses reconstruction; censored/timeouts cannot yield
a complete passing latency percentile. Drain starts are reported separately.

Reports separate submit, poll, lease-ACK, event-ACK and provider-operation wire
histograms, job success, first-attempt success, queue-to-ACK and end-to-end job
latency. Job/attempt success uses the first durable observation received before
the frozen deadline, sampled every 250 ms. The queue-delay proxy uses the DB
lease-ACK receipt's transaction timestamp minus job creation, **not** response or
commit timing. Provider wire duration includes transport and observation overhead;
provider service time is explicitly unmeasured.

The preload reports journal wall/CPU cost and extra clone wait. The control-plane
journal reports write cost and observer-query time. These durations are retained,
never subtracted from latency. Clone wait includes response download, so it is
not a pure observer cost. A matched uninstrumented control is still required to
attribute net telemetry overhead under load.

The original thresholds remain: quiet throughput ≥90% isolated baseline,
queue-to-ACK p95 ≤2× baseline, 5xx ≤0.1%, submit/poll/event-ACK p95
≤750/1000/500 ms, and no failed/censored/timed-out/unresolved required work.
The output always sets `fullD5Satisfied:false`.

The real builder/mint regression is in the already registered
`scripts/lib/__tests__/m4-daemon-load-driver.test.mjs`. It requires a built server
at this checkout's `server/dist`, or explicit `AOA_M4_SERVER_DIST` pointing to the
same candidate's build. It uses the pinned workspace `tsx` loader to resolve
workspace source exports and verifies the three original mint refusals before
the corrected positive control. A missing build is an explicit skip, not proof
that credential setup passed.

Inventory comes from the durable control-plane journal and must contain valid,
distinct quiet/noisy worker, target, provider-profile and enrolled hello snapshots.
The captured stdout inventory must agree. Comparison refuses missing inventory,
changed snapshots or mismatched fixture UUIDs; absent values cannot compare as a
passing match. Reports retain the selected capacity cohort. Actual enrolled
batch slots and provider-operation limits must match it; historical provider
profile IDs must also bind the exact fixture UUID.

Before selecting a product fix, add candidate-scoped timing evidence for pool
acquisition, SQL execution, authority locks, event ingestion and daemon
backpressure alongside these request/provider-wire measurements. A low-capacity
profile or interval is a hypothesis, not causal proof; raising it to turn the
report green would change the experiment. This harness does not close that
profiling requirement, actual paid-provider qualification or D5's 20-org,
2,000-queued-job, 100-active-lease, 10,000-events/min, 60+15-minute/HA requirements.

## Capture and exact cleanup

Retain `*.report.json`, `*.raw.json`, phase `*.stream.ndjson`,
`*.durable.ndjson`, `*.quiet.ndjson`, `*.noisy.ndjson` and `*.exit.json`, plus
sanitized candidate/image IDs and effective public profile configuration. Stream
and durable journals allow independent reconstruction; keep failed records.
On incomplete execution, use compose `cp` to capture
`control-plane:/aoa/m4-baseline.ndjson` (or `m4-loaded.ndjson`) and each
worker's `/worker/m4-requests.ndjson` before removal. `compose cp` works for stopped
containers, unlike `exec`. Retain service logs after scanning/redacting credentials.
Do not retain raw rendered compose output containing private environment values.

After capture, remove **only this exact project**, using the same compose files:

```sh
docker compose --project-name "$AOA_E6F_COMPOSE_PROJECT" \
  --env-file /absolute/private/w11-fixture/fixture.env \
  -f docker-compose.d1.yml -f /absolute/private/w11-fixture/compose.json \
  down --volumes --remove-orphans
docker ps -a --filter "label=com.docker.compose.project=$AOA_E6F_COMPOSE_PROJECT"
docker volume ls --filter "label=com.docker.compose.project=$AOA_E6F_COMPOSE_PROJECT"
docker network ls --filter "label=com.docker.compose.project=$AOA_E6F_COMPOSE_PROJECT"
```

Record zero remaining project containers, volumes and networks. Revoke/remove
fixture credentials by removing its private database/volumes and private input
files after evidence capture. Never prune unrelated projects or shared images.
