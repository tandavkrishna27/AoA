# SVC-004 witnessed exit recovery checkpoint

This implements the witnessed process-exit portion of SVC-004. The reconciler
reads durable instance identity and immutable accepted stop events under the
existing service row lock. Tenant, company, service, generation, job and attempt
must match. The earliest accepted stop timestamp per instance anchors backoff;
duplicate stop events and subsequent instance updates cannot renew it.

The server default permits four replacements with exponential delays of 1, 2,
4 and 8 seconds. A fifth witnessed exit in ten minutes pauses desired state and
writes the existing company-scoped desired-state activity in the same transaction.
The ten-minute window expires naturally. A resume while five exits remain in the window pauses again;
a new generation has its own history. Existing submission budget/capacity checks,
the live-instance unique index and generation placement fence still apply.
Actual replacement latency includes the reconciler polling interval.

Only an accepted `service_instance_stopped` observation with
`terminalized_by=worker_stopped` and no earlier matching
`service_graceful_stop_observed` qualifies. The graceful ladder used for requested
stop, drain, budget lapse and authority expiry emits that request event before
witnessing the stop. Accepted attempt terminal events marked cancelled or expired
also exclude recovery accounting. Spontaneous observed absence qualifies even
when the provider cannot report an exit code. Liveness loss, unconfirmed stop and
startup failure retain their existing behavior and are outside this checkpoint.
This is a server default; no new restart-policy API or frozen workload field was
introduced.

Focused verification: four pure policy tests and 27 real PostgreSQL reconciler
tests, including concurrent restart, concurrent pause/audit, controlled stop,
company mismatch, generation separation and timestamp/replay stability. Windows
integration requires `AOA_RUN_WIN_INTEGRATION=1`; temporary PG data is under
`D:\AoA-test-temp`. Full workspace verification is owned by the M3 integration run.

## Portable application-file recovery

The original application explicitly writes regular JSON state files under
`/home/user/aoa-output` before stopping. A witnessed completed/exit outcome exports
these through the existing fenced artifact window before terminal and sandbox
teardown; unconfirmed stop and closed ownership do not export. Existing capability,
redaction and teardown headroom limits apply. Export is best effort; approval only
accepts committed artifacts. This does not capture arbitrary process memory.

The board's existing authorized generation-roll operation accepts `checkpointFiles`
with `sourceJobId`, `sourceAttempt`, `sourceGeneration`, and up to 16
`files: [{artifactId, path}]` references. `path` is a relative regular JSON path.
The server verifies the stopped source instance's company/service/generation,
committed artifact expiry, actual object size and SHA-256, and rejects state that
changes under the existing secret redactor. Each file is at most 1 MiB and the
manifest's state total is at most 8 MiB. It creates a committed manifest in the
same transaction as the immutable next-generation definition and its audit.
`checkpointRestore` may instead identify an already committed verified manifest;
the two inputs are mutually exclusive. Raw legacy checkpoint pointers remain
fail-closed without this binding.

The reconciler re-verifies all bytes and copies state to the new attempt's object
prefix, committing staged pointers atomically with the submitted job. The provider
imports files to `/tmp/aoa-service-state/{serviceId}/{path}` before process start.
The daemon requires the generation-specific staging marker and successful receipt
before emitting restored or starting the process. Applications must read those
files explicitly. Destination ancestor symlinks, traversal, corrupt/missing bytes,
expired artifacts, company mismatch and unapproved source generations are refused.
Local-disk-only storage is not accepted as portable authority.

Focused verification includes real PostgreSQL and actual filesystem object bytes
behind the portable store interface, provider destination guards, stage-before-start
supervisor behavior, and witnessed export ordering. These tests make no claim of a
live S3/E2B deployment certification. Full workspace checks remain serialized by
the M3 integration owner. Automatic periodic checkpoint scheduling and arbitrary
memory snapshots are outside this application-file contract.
