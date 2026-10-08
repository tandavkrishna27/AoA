# M4 Docker worker slots and recovery

Date: 2026-10-08
Status: proposed written spec; Option 1 direction approved, implementation pending review.

## Outcome

Keep Docker and make each logical worker independently enrolled, durable and
replaceable. The user's first practical journey is one cloud control room paired
with one Docker worker on their desktop, submitting permitted work, receiving
results, then restarting and reconnecting with the same identity.

M4 supplies reliable fleet identity and recovery. It must not describe cloud-to-
desktop execution as verified until the complete journey runs. Existing provider,
credential and execution-policy prerequisites still apply.

## Existing constraints

- Preserve company isolation, authenticated enrollment, target binding, generation
  fencing, approval gates, budget stops and mutation activity logging.
- Reuse enrollment and organization target revocation. Never delete worker rows
  or reset identity records to bypass an existing binding, including revoked rows.
- Preserve persist-before-network and idempotent enrollment replay.
- Keep dispatch opt-in and the default daemon image command unchanged. The
  networked host is an explicit composition choice, not a global image switch.
- No Anthropic live verification, replacement provider, paid calls, production
  deployment or main merge. Integrate reviewed engineering through normal program
  branch PR/CI. No additional certification campaign.
- M3 network enforcement and application-session prerequisites remain unresolved.
  Local M4 evidence cannot close them or establish production D5 timings/load.

## Architecture

### Worker slot

A slot is an operator-managed logical deployment unit: one target, one enrollment
ticket, one durable state volume and at most one running worker. Slot names identify
deployment resources; the enrolled ticket remains the authority for target and
organization identity. Never derive server identity from a service label.

Use a bounded fleet inventory to render individual Docker services, each with
replicas set to one, its own secret reference and volume. Scaling adds or retires
slots within explicit configured bounds. It must not replicate one service's
credentials or silently cap the entire fleet at one worker. Reject duplicate slot,
target, credential-reference or state-volume assignments before rendering.

The generator is deterministic and does not enroll workers, create infrastructure,
read secret contents or change server authority. Operators provision targets and
tickets using existing authorized flows. A slot becomes runnable only after its
individual inputs exist. Document bounded scale-out as an operator workflow;
unattended autoscaler integration is not claimed by generated Compose alone.

### State ownership

Identity, receipt, event outbox and lease recovery state belong to the same slot's
durable directory. Audit actual path configuration and reject conflicting paths
for the supported slot composition rather than merely documenting co-location.

Acquire exclusive state ownership before enrollment, network listeners or dispatch.
A second local process using the same state must fail closed. Prefer a lifetime
OS lock through a narrowly scoped composition seam; a PID file or expiring lock
alone is insufficient. Crash termination must release ownership without requiring
automatic deletion of a potentially live owner's lock. The implementation plan
must identify and prove the exact supported Docker/Linux locking primitive before
product changes; dependency changes follow manifest-plus-generated-lockfile policy.

The initial supported storage is a local durable Docker volume on its assigned
host. Do not mount it concurrently on another host or claim automatic node failover.
Cross-host shared filesystems are unsupported unless an exclusive attachment and
fencing contract is separately implemented and verified. Server lease fencing
remains required even when local ownership is exclusive.

### Restart, retirement and replacement

- Normal restart: same target and intact state, reacquire exclusive ownership,
  replay persisted enrollment/outbox state and resume under current server fences.
- First enrollment: explicitly provisioned fresh slot and valid unused ticket.
- Missing established state: stop and require recovery; never automatically mint a
  replacement identity for a previously enrolled target. Persist a nonsecret slot
  binding outside the disposable container so a lost state volume is detectable.
- Corrupt identity or receipt: fail closed; never overwrite or reset automatically.
- Retirement: stop new work, drain within existing bounded shutdown behavior,
  revoke target authority through the native route, confirm the old runtime has
  stopped and retain state for recovery/audit. Forced termination cannot authorize
  duplicate execution; existing server reconciliation owns abandoned leases.
- Replacement on the same host: reuse intact state only after the old owner stops.
- Lost or unreachable host: revoke/fence old authority and provision a new target,
  ticket and state volume. Do not reuse a copied live identity or infer that a
  network partition means the old worker stopped.

## Deployment and desktop journey

Supply an explicit desktop-worker example with a configurable cloud endpoint,
dedicated secret reference, durable volume and opt-in networked-host command.
Keep credentials out of generated output, logs and image layers. Document outbound
connectivity and TLS prerequisites using the actual transport's endpoint contract;
do not promise inbound-port-free operation until source and a test establish it.

Local project access requires explicit permitted mounts. Native desktop apps,
personal-account credential brokerage and unrestricted host filesystem access are
outside this change. A networked provider endpoint does not by itself prove that
execution happens on the desktop; the journey must establish execution placement
using the supported provider/target path before making that product claim.

First verification uses an isolated control plane and deterministic non-model task
or existing fake provider. Report this as local integration evidence. Real cloud
enrollment and execution are a separate environment-dependent check, using an
authorized endpoint and credentials without paid model calls.

## Database and object recovery

Exercise the shipped `aoa db:restore --file` command against a newly created,
isolated PostgreSQL destination, never a configured development/production DB.
Round-trip both supported SQL and compressed SQL where available. Verify restored
tenant data and migration metadata, then exercise real fence guards against state
restored by that command. Cover nonzero command failure and invalid input.

Reuse manifest reconciliation and quarantine. Missing or corrupt object bytes must
not be promoted or served successfully. Measure the local rehearsal but do not
substitute its timings for production RPO/RTO or cross-domain failure proof.

## Acceptance evidence

1. Two distinct slots enroll with distinct identities; duplicate assignments fail.
2. Concurrent starts on one state directory admit one owner before any network use.
3. Clean restart and crash/restart preserve identity and replay state safely.
4. Missing established state and corrupt records refuse startup without reminting.
5. Bounded scale-out preserves unique credentials/state; retirement and replacement
   reject old authority without deleting binding rows or bypassing tenant access.
6. Rendered manifests validate and preserve dispatch defaults and secret boundaries.
7. Actual CLI backup/restore round-trip executes on isolated PostgreSQL; restored
   stale authority is rejected and corrupt/missing objects remain quarantined.
8. Desktop example is validated; execution placement and end-to-end cloud evidence
   are stated precisely, with unexecuted environment checks left visible.
9. Run focused regressions, recursive typecheck, full test suite and build, then
   required PR CI. Record platform skips and proof limits explicitly.

## Delivery order

Write and review the implementation plan after this spec is approved. Implement
state ownership and established-slot loss detection first, deterministic fleet
rendering and lifecycle workflow second, actual restore integration third, then
the desktop journey and requirement-to-evidence reconciliation. Existing heavy
verification runs serially across worktrees. Keep the user's primary checkout
untouched throughout.
