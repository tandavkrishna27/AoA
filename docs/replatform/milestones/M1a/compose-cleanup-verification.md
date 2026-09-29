# Shipped-Boot Compose Cleanup Verification

This describes the bounded Compose cleanup repair, not a campaign result or a
change to M1a acceptance requirements. Provider cleanup, D1 final collection,
and full private evidence custody remain separate obligations.

## Phase Order

The shipped-boot workflow collects service snapshots before removing containers,
runs `journey.mjs teardown --out <private-output-dir>` through the job-log filter,
then runs the final leak scan before uploading the evidence directory. The final
`purge-secrets` phase runs after the upload attempt, including on failures.

`teardown` no longer deletes scanner state or secrets. Manual phase execution
must also finish with `journey.mjs purge-secrets --out <private-output-dir>` after
scanning and handling evidence. The private state/env/key files must never be
uploaded. `purge-secrets` attempts all removals and fails if any removal is unproven.

## Evidence Boundary

`evidence/compose-cleanup.json` records the candidate supplied by the phase state,
the fixed Compose project, the down-command status, and post-down observations
of containers (including stopped containers), networks and volumes selected by
the exact `com.docker.compose.project=aoa-m1-boot` label. Only a successful down
and three successful, empty inventories pass. Nonzero/null status, command errors,
missing output and remaining resources refuse success. All inventory queries are
attempted even when down or another query fails. Raw command/error text is not
retained in this report.

This is `scope: compose-project-only`, with `providerCleanup: not-assessed`.
The fixed project label is the cleanup boundary, not independent evidence that
each removed resource was created by the named candidate. No host-wide resource
deletion or provider request is added.

A cleanup failure fails the job but its safely scanned report may still upload.
A teardown log-capture failure blocks upload independently. Missing scanner state
also blocks publication. Secret purge remains an always-run step after upload.

## Remaining Work

This slice does not prove provider-sandbox absence, complete journey/redaction
resource inventory, cleanup deadlines for every owned resource, D1 teardown, or
first-byte private custody. Existing service snapshots still precede teardown and
retain only the last 2 MB per service; they are not complete terminal transcripts.
Do not promote pending campaign cases or certify M1a from this report alone.

Offline verification uses the real journey phase entry point with only the Docker
process boundary substituted, plus workflow mutation tests. Live Docker and real
provider execution require their separately approved environment and authority.
