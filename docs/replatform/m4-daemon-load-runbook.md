# Bounded W11 real-daemon diagnostic

This disposable engineering fixture uses authenticated HTTP job submission, the
production placement service, two separately enrolled networked worker daemons,
and the shipped deterministic D1 provider through its gated wire. It requires no
paid provider credential. SQL creates fixture organizations, companies, agent
keys, target/enrollment authority and a harmless company secret handle; it never
creates jobs, attempts, leases or placement snapshots. Submission and placement
run in the built control-plane image. The handle allows the ordinary fenced
secret redemption to deliver the owned-label capability to the networked host.

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

## Prepare and start (operator only)

Build the current candidate's control-plane, worker and D1 fake-provider images
using their checked-in Dockerfiles. Record the source revision, build exits and
actual image IDs/digests. Do not copy compiled output from another checkout.
Supply `AOA_D1_CONTROL_PLANE_IMAGE`, `AOA_D1_WORKER_IMAGE` and
`AOA_D1_FAKE_PROVIDER_IMAGE` with those images. The base D1 compose supplies the
PostgreSQL, MinIO, toxiproxy and test-runner dependencies.

From this checkout, with Node 24.19.0 and a unique absolute evidence directory:

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

PowerShell uses `$env:AOA_D1_LIVE='1'` and
`$env:AOA_E6F_COMPOSE_PROJECT='aoa-m4-daemon-unique-suffix'`; use the same compose
argument list. No host port is required: the driver executes submission and
observation inside the isolated control-plane service.

Private input files are created exclusively with mode 0600. On Linux, arrange
ownership of the generated bind files for the containers' node UID 1000 before
bring-up (for example a scoped `chown -R 1000:1000` of the **verified exact new
fixture directory**). Keep the directory private. Do not upload
`manifest.private.json`, `fixture.env`, private signing key or enrollment tickets.
The provider receives only the public key; the control plane alone receives the
private key. Fresh worker named volumes keep identities and slot state separate.

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
