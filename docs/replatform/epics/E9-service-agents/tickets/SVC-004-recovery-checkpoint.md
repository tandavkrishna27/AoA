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

Portable checkpoint recovery remains open. `checkpointArtifactId` is an input
pointer, and the service supervisor does not consume it. The reconciler refuses
new placement with `checkpoint_recovery_unavailable` when this pointer is non-null,
so requested recovery cannot silently start without restored state. Provider checkpoint and
restore operations currently pause/resume an opaque provider resource. There is
no service contract that exports checkpoint bytes into committed artifact storage,
binds their verified hash and generation to an approved service checkpoint, then
downloads and imports those bytes into a replacement sandbox before process start.
Neither a local disk snapshot nor the opaque provider snapshot reference proves
the accepted store-to-provider recovery requirement. Corrupt/old-generation
checkpoint rejection and successful portable restore therefore remain unclaimed.
