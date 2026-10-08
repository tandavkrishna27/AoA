# Docker worker slots: provisioning and recovery

Status: engineering workflow; no production rollout or desktop-local execution proof.

## What runs where

A Docker worker on a desktop can maintain its own durable identity and connect to
the control plane. The current networked provider delegates to adapter-manager;
the production adapter-manager uses E2B. A local worker or local project mount
does not make the coding task run on that desktop. Native desktop applications,
personal credentials and a local execution backend remain separate work.

The guarded composition supports Linux local Docker volumes, including Linux
containers under Docker Desktop. Native Windows worker processes are not covered
by this Linux flock mechanism. There is no automatic cross-host volume failover.

## Prepare one fresh slot

1. Use the existing authorized organization target/enrollment flow to provision a
   distinct target and ticket. The ticket must belong to this target. The server
   remains the authority for organization access; inventory IDs grant no access.
2. Choose a unique slot name, state volume, host binding directory and ticket file.
   Create the host directory explicitly with permissions writable only by the
   worker/operator. Create the named Docker volume explicitly and initialize its
   ownership for the image's non-root `node` user. Do not reuse another slot's volume.
3. With the admitted worker image, run its explicit provisioning command in a
   disposable container mounting only the independent binding directory:

   ```sh
   node /worker-app/dist/bin/provision-slot.js \
     --binding-dir /slot-binding --slot-id desktop-1 \
     --organization-id <organization-uuid> --target-id <target-uuid>
   ```

   This command is an operator action, not an automatic boot fallback. It creates
   `slot.json` once and refuses replacement. The binding directory is independent
   of the state volume. It must survive state-volume loss.
4. Write the full encoded enrollment ticket to `enrollment.ticket` in the host
   binding directory using a secure operator mechanism. Do not place ticket bytes
   in inventory, shell history, logs or committed files. Compose maps this file to
   `/run/secrets/enrollment-ticket`; it is a file-backed secret supported by local
   Compose, not a Swarm-only external secret. The reference name must be unique.
5. Copy `docker/worker/slots.example.json`, replace example endpoints and the dummy
   image digest, and supply the actual IDs, directory and volume references.

   ```sh
   node scripts/render-worker-slots.mjs <inventory.json> > <slots.compose.json>
   docker compose -f <slots.compose.json> config
   ```

   The renderer reads no ticket contents. It rejects unknown fields, duplicate
   assignments, unsafe interpolation, unpinned images, insecure remote endpoints
   and inventories outside explicit min/max bounds. State volumes are external;
   missing volumes fail rather than silently recreate established state. Binding
   mounts use `create_host_path: false` for the same reason.
6. Review the render before using your normal deployment process. Dispatch stays
   `false`; rendering/provisioning does not enable execution. Use the existing
   governed deployment/provider configuration to enable dispatch only when its
   prerequisites are established. No rollout is authorized by this document.

## Normal restart and bounded scale-out

Restart with the same target, independent binding and state volume. Exclusive OS
ownership covers binding and state for the entire runtime; a second worker using
either directory refuses before enrollment. Never unlink `.aoa-slot.lock` while a
worker is alive. Kernel locks release when the holder/process dies; lock-file
presence is not evidence of a live owner.

Add unique slots to the inventory within its bounds, provision each target/ticket
and state independently, then render again. Each slot has one replica and uses
stop-first updates. Scale the inventory, not the replica count of an enrolled
service. This is bounded operator-driven scale-out; no unattended autoscaler is
claimed. The staging template starts with four slots across two failure domains.

## Retirement and replacement

1. Stop new work and invoke existing bounded worker drain/shutdown.
2. Revoke the target through the existing organization-admin target revoke route.
   Preserve its generation fencing, authorization and activity logging.
3. Confirm the old runtime stopped before transferring local storage ownership.
   Retain binding/state for audit and recovery; do not delete server worker rows.
4. On an unreachable/lost host, provision a new target, ticket, binding and state
   after fencing/revocation. Never copy a potentially live identity to a new host.

## Refusals and recovery

- Missing/corrupt binding, mismatched incarnation or missing established identity:
  stop. Restore the matching binding and state only after confirming old ownership
  stopped, or retire/revoke and provision a new target. Never reset identity on the
  already bound target.
- Crash after `initializing` but before first identity persistence: explicit operator
  inspection is required. Automatic mint retry would also permit remint after state
  loss, so the guard refuses it.
- Identity persisted but receipt absent during initializing: restart reuses the
  same identity and enrollment idempotency. Existing ticket expiry/authority rules
  still apply; a refused authority cannot be bypassed by deleting local state.
- Legacy workers: their existing unguarded composition remains unchanged. Fresh
  slot mode refuses nonempty state. Validated adoption is not yet exposed because
  the current receipt/ticket has no authenticated organization metadata contract;
  do not invent one from a label or unsigned token. Use a newly provisioned target
  after native revocation when migrating, or retain the legacy composition.

## Verification and limits

The Linux fixtures use the built worker image without networking, as the non-root
worker user. They check contention, aliases, process crash, holder loss, initialization
recovery, restart identity continuity, wrong-target persistence refusal and recovery
path containment. Bootstrap enrollment in the host fixture is injected: this is
storage/composition evidence, not a real cloud or provider execution claim.

Existing enrollment and server PostgreSQL suites supply their separate authority
evidence. A real cloud-to-desktop journey and any desktop-local execution backend
remain explicitly unverified here. M4's actual CLI restore rehearsal and full HA
requirement reconciliation follow separately; local tests do not prove production
RPO/RTO, load floors or the remaining M3 provider/session prerequisites.
