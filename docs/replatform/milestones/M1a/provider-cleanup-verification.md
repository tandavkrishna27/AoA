# Shipped-Boot Provider Cleanup Evidence

This is the continuation of the Compose cleanup repair, not a campaign result,
provider admission approval, or M1a certification. No paid run is authorized by
this change.

## Resource Inventory

Before any keyed journey sends its issue-creation request, and before either
redaction arm seeds its job, the driver appends and flushes a non-secret intent
to `resource-intents.jsonl` in the private output directory. Records bind the
candidate, tenant, organization, company, target and worker. Redaction also
records the preallocated job and attempt; journey records a unique issue title
so a lost HTTP response does not erase the lookup identity.

Teardown first stops all three workers while leaving the adapter and database
available for graceful cleanup. It reads the recorded intents before removing
Postgres. Its owner-role
readback joins every matched job/attempt/lease to `attempt_started` events on
the complete organization/company/job/attempt/lease tuple. It does not reuse
worker-log identity counts as proof of cleanup. All declared attempts must have
terminal statuses, closed leases and well-shaped sandbox identities. Missing
jobs/events/leases, wrong identities, conflicting sandbox ownership, active
execution, failed queries and incomplete journal records make the inventory
incomplete. Journey lookup uses submission-time `jobs.source_intent`, not a
heartbeat marker written later. A control journey explicitly expects zero jobs;
unexpected control jobs fail the verdict while retaining discoverable resources.
Torn journals retain their valid complete records but cannot pass completeness.
Queries are bounded by 30 seconds each and a shared 180-second
collection budget; this is not an extension of any resource-removal deadline.

`evidence/provider-resource-inventory.json` retains the snapshot. The final
report is separate from `compose-cleanup.json`, whose scope remains Compose
only. Compose removal is still attempted if inventory collection or its evidence
write fails. Scanner state survives until the existing final scan/upload/purge
sequence.

## Provider Readback

After Compose removal, the observer makes bounded GET requests to the fixed E2B
cloud API. Each sandbox requires a same-team and same-execution `created` to
`killed` lifecycle pair within its independently supplied lease-creation to
post-down window. A later lifecycle transition, missing or malformed event,
contradictory presence, request error or incomplete pagination refuses success.
The subsequently exhausted running-and-paused list must omit the sandbox. A
404 alone is never absence proof. No connect/resume/delete API is called.

This establishes logical provider sandbox deletion, not physical host erasure.
E2B documents `killed` as terminal and non-resumable in its
[lifecycle contract](https://docs.e2b.dev/sandbox/persistence#state-descriptions).
The [pinned implementation](https://github.com/e2b-dev/infra/blob/5cfcf3282ddb95e90a8214ce71329641bdfe6cb6/packages/orchestrator/pkg/server/sandboxes.go#L723)
withdraws a sandbox from live queries before asynchronous host cleanup finishes.
The [events endpoint](https://github.com/e2b-dev/infra/blob/5cfcf3282ddb95e90a8214ce71329641bdfe6cb6/packages/api/internal/handlers/sandbox_events.go#L63)
scopes requests to the authenticated team. Identities in the report are observed,
not a replacement for separate provider admission/provenance approval.

`evidence/provider-cleanup.json` requires complete local inventory, passing
provider readback, and successful Compose cleanup. Both reports survive until
the final leak scan. Keyless teardown remains Compose-only. Paused-only snapshot
deletion without the required lifecycle pair remains unproven; this change adds
no deletion-receipt shortcut and no provider mutation.

The observer defaults to a shared ten-second request budget, with at most 100
resource IDs, 20 event pages per ID and 20 listing pages, each limited to 100
items and 1 MiB. Bound exhaustion is unknown/failure, never truncated success.

## Remaining Boundaries

This journal records intended harness operations, not provider create receipts.
A provider create whose identity was never durably reported remains unresolved;
the inventory must not turn that uncertainty into an empty successful result.
It does not cover another runner, D1 resources, deferred fault drivers, resources
outside these declared jobs, or a compromised candidate modifying the journal.
The protected runner and independent custody obligations remain separate.

The Node regression suite substitutes only Docker/HTTP boundaries and makes no
provider requests. Five additional PostgreSQL tests execute the actual generated
query over typed CTE fixtures; they cover missing heartbeat markers, lease
binding, missing events, unexpected control jobs and redaction scope. The old
heartbeat-only lookup was mutation-tested and failed four of those five checks.
These query fixtures do not replace a migrated live stack run.
Live Compose/provider verification remains required in
the separately approved environment. Do not promote pending cases or represent
component test success as a completed cleanup campaign.
