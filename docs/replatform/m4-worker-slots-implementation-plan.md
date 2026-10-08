# Docker worker slots implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution or superpowers:subagent-driven-development if the user selects delegation. Track steps with checkboxes.

**Goal:** Ship independently enrolled Docker worker slots with exclusive durable state, explicit loss detection and safe lifecycle instructions.

**Architecture:** Add an opt-in slot composition around the existing container host. Keep server enrollment, wire contracts, default image command and generic embedding APIs intact. Render bounded individual services rather than cloning one identity through replica counts.

**Tech stack:** TypeScript, Node filesystem/child-process APIs, Linux util-linux `flock`, Docker Compose, Vitest and existing native target revoke routes.

**Spec:** `docs/replatform/m4-docker-worker-slots-design.md` (approved 2026-10-08).

## Global constraints

- Preserve company isolation, authenticated enrollment, target binding, generation fencing, approval gates, budget stops and mutation activity logging.
- Preserve persist-before-network and idempotent enrollment replay.
- Keep dispatch opt-in and the default daemon image command unchanged.
- No Anthropic live verification, replacement provider, paid calls, production deployment or main merge.
- Local durable Docker volumes only; no automatic cross-host failover claim.
- Never silently reset or remint established identity; never delete revoked binding rows.
- Desktop worker connectivity does not establish desktop-local execution.
- Keep the primary checkout untouched; logs and isolated fixture files use the system temporary directory.
- Use `pnpm.cmd` on Windows; run heavy verification serially.

## Review focus

1. Alias/symlink paths must not let two processes bypass ownership (Task 1).
2. Parent crash must release OS ownership; a hung or failed lock child must refuse boot (Task 1).
3. Both identity and receipt disappearing must be detected, including initialization crashes (Task 2).
4. Existing generic container embedders must keep their current behavior; new fleet paths must not bypass guards (Task 3).
5. Duplicate references and invalid inventory bounds must fail without emitting runnable partial output or secrets (Task 4).

## Delivery boundaries

This plan implements the worker-slot slice. Actual CLI database recovery is a separate
testable subsystem: write its concrete plan against the approved recovery section
after this slice, before changing restore code/tests. A final M4 reconciliation
records HA01..04, L01..06 and DR01..07 evidence and confirmed engineering gaps.
Neither plan closes production timing/load proof or desktop-local execution.

## Task 1: Prove and encapsulate exclusive Linux ownership

**Files:**
- Create `packages/worker-daemon/src/identity/slot-ownership.ts`
- Create `packages/worker-daemon/src/__tests__/slot-ownership.test.ts`
- Create `tests/d1/m4-slot-ownership.test.mjs`
- Modify `docker/worker/Dockerfile` only to include the explicit util-linux runtime requirement.

**Interfaces:**
- Produce `acquireSlotOwnership(paths: readonly string[]): Promise<SlotOwnership>`.
- `SlotOwnership` exposes `release(): Promise<void>` and `lost: Promise<Error>`.
- Reject unsupported OS, missing flock, malformed paths, contention and loss of the holder. No new worker-daemon package dependency.

- [ ] Write failing tests: two contenders on the same canonical directory admit exactly one; alias paths contend; a missing lock executable refuses; holder death resolves `lost`; release is idempotent.
- [ ] Run `pnpm.cmd exec vitest run packages/worker-daemon/src/__tests__/slot-ownership.test.ts`; confirm expected failures.
- [ ] Prove the Linux primitive with a throwaway Docker subprocess fixture: spawn `flock --nonblock` with a constant shell program holding the lock while parent stdin remains open. Use argv for paths, never shell interpolation. Require a bounded ready handshake; kill/reap the helper on failed startup. Lock files remain present permanently and are never unlinked. Test normal exit, forced parent death and acquisition by a successor. The holder must not outlive an exited parent through leaked stdin descriptors.
- [ ] Implement the helper using canonical existing directory paths, sorted/de-duplicated before acquisition; acquire binding and state directory locks before returning. Release acquired locks on any failure. Reject symlink lock files and detect replacement of lock files/directories before boot; supported volumes cannot be replaced while live. Exit the slot runtime if ownership is lost.
- [ ] Run unit tests and the Docker Linux fixture; expect zero skipped lock cases in the targeted Linux run. If the subprocess proof fails, stop this task and revise the primitive before product integration; do not substitute a PID/TTL lock.
- [ ] Commit this tested ownership unit and its runtime prerequisite with explicit paths.

## Task 2: Independent durable provisioning and binding state machine

**Files:**
- Create `packages/worker-daemon/src/identity/slot-binding.ts`
- Create `packages/worker-daemon/src/__tests__/slot-binding.test.ts`
- Create `packages/worker-daemon/src/bin/provision-slot.ts`

**Interfaces:**
- `SlotBinding`: version 1, slotId, organizationId, targetId, stateIncarnationId, phase (`fresh` | `initializing` | `established`), optional workerId only before establishment.
- `provisionSlot(input: { bindingDir: string; slotId: string; organizationId: string; targetId: string }): Promise<SlotBinding>` creates a fresh record exclusively; never replaces an existing record.
- `prepareSlot(input: { bindingDir: string; stateDir: string }): Promise<PreparedSlot>` validates paths, record and state marker, durably transitions fresh to initializing before enrollment.
- `PreparedSlot.validateIdentity(identity, receipt): void` consumes existing exported identity/receipt types; organization validation uses enrollment metadata, not an invented identity field.
- `PreparedSlot.establish(identity, receipt): Promise<void>` writes established only after matching persisted receipt; it does not enroll or mint identities.

- [ ] Write failing tests asserting missing/corrupt binding refuses; binding directory equal to or inside the state directory refuses; duplicate provisioning never overwrites; fresh transitions once; initializing without identity refuses; established missing both records refuses; wrong target/worker/incarnation refuses.
- [ ] Add crash-boundary cases: before initializing persistence, after initializing but before identity, identity without receipt, enrollment receipt before established persistence, and established normal restart. Assert no remint or network action for refusal cases.
- [ ] Run `pnpm.cmd exec vitest run packages/worker-daemon/src/__tests__/slot-binding.test.ts`; confirm expected failures.
- [ ] Implement strict bounded record validation and atomic fsync/write/rename/directory-fsync on Linux. Fresh initialization creates an incarnation marker without overwriting existing state. Initializing replay requires the persisted identity; existing enrollment code handles its idempotent retry. Provisioning output is content-free apart from nonsecret IDs; it never accepts tickets/private keys.
- [ ] Implement explicit adoption as a separate CLI mode: load existing intact identity and receipt under both locks, require caller-supplied expected target and organization, validate against authorized enrollment metadata before creating established binding. Refuse adoption if identity/receipt or authority evidence is missing; never infer organization from service labels.
- [ ] Run unit and Linux durability cases; commit with explicit paths.

## Task 3: Opt-in slot host, durable path enforcement and lifecycle

**Files:**
- Create `packages/worker-daemon/src/bin/slot-host.ts`
- Create `packages/worker-daemon/src/__tests__/slot-host.test.ts`
- Modify `packages/worker-daemon/src/bin/container-host.ts` with narrow pre-enrollment/after-enrollment hooks if required.
- Modify `packages/worker-networked-host/src/bin/networked-host.ts` to select guarded composition only with explicit slot configuration.
- Modify `packages/worker-daemon/src/index.ts` for required composition exports.
- Extend `packages/worker-daemon/src/__tests__/container-host.test.ts`.

**Interfaces:**
- `runSlotHost(deps: ContainerHostDeps & { bindingDir: string }): Promise<{ ok: boolean }>` acquires ownership, validates binding/state and invokes existing bootstrap without changing generic host semantics.
- Environment: `AOA_WORKER_SLOT_BINDING_DIR` selects guarded mode. State remains `AOA_WORKER_STATE_DIR`; outbox and lease-candidate variables use existing config names discovered in `config/config.ts`.

- [ ] Write failing tests: no bootstrap/enrollment/socket call before ownership and binding validation; mismatched recovery paths fail; ownership loss stops the runtime; guard cannot be bypassed by invoking container-host directly with slot env; legacy env without slot configuration retains existing behavior.
- [ ] Add normal restart and identity-before-network enrollment crash replay tests, plus two independent slot identities. Use real file records and existing enroll-once dependency injection.
- [ ] Run `pnpm.cmd exec vitest run packages/worker-daemon/src/__tests__/slot-host.test.ts packages/worker-daemon/src/__tests__/container-host.test.ts`; confirm expected failures.
- [ ] Implement opt-in composition. Require file_record custody. Canonicalize recovery paths and require their parent beneath the slot state directory, rejecting escape/symlink paths; preserve generic path APIs outside slot mode. Hook successful persisted enrollment to establish binding before normal poll/dispatch begins. Keep ownership for the entire process lifetime, not merely bootstrap's return.
- [ ] Wire bounded drain and existing signal shutdown before release; on fatal ownership failure terminate rather than resume polling. Test shutdown ordering and double release. Do not invent a new server revocation protocol.
- [ ] Run focused daemon and networked-host suites and package typechecks; commit with explicit paths.

## Task 4: Deterministic bounded fleet rendering and operator workflow

**Files:**
- Create `scripts/lib/worker-slot-inventory.mjs`
- Create `scripts/render-worker-slots.mjs`
- Create `scripts/render-worker-slots.test.mjs`
- Create `docs/replatform/worker-slots-runbook.md`
- Create `docker/worker/slots.example.json`
- Modify `docker-compose.staging.yml`, `scripts/check-staging-manifest.mjs`, its tests and `tests/d1/e6f-12-staging-render.test.mjs` together.

**Interfaces:**
- `validateWorkerSlotInventory(value): WorkerSlotInventory` accepts version 1, integer min/max bounds and slots with slotId, organizationId, targetId, binding-directory reference, volume name, enrollment-secret reference and failure domain.
- `renderWorkerSlots(inventory): string` emits deterministic Compose YAML only after whole-input validation. No environment interpolation from untrusted inventory values; use a restricted identifier grammar and JSON-compatible quoted scalar serialization.

- [ ] Write failing tests for duplicate slot/target/secret/volume/binding paths, empty IDs, unsafe characters, min greater than max, slot count outside bounds, and cross-organization accidental reuse. Assert no secret contents are read and failure emits no partial manifest.
- [ ] Run `node --test scripts/render-worker-slots.test.mjs`; confirm expected failures.
- [ ] Implement renderer: one service per slot, replicas 1, distinct durable volume and binding mount, individual secret reference, explicit guarded networked-host composition, pinned operator-supplied image reference. Dispatch remains default-off; enabling it requires existing provider prerequisites. Require externally provisioned binding directories and state volumes rather than silently recreating established storage.
- [ ] Reconcile staging intent and its static/render guards so the old shared-ticket replicated pattern cannot remain the claimed fleet topology. Preserve two failure domains, minimum four workers and existing secret/provider boundary policies.
- [ ] Document provision → enroll → restart, bounded scale-out and drain → revoke → confirm stop → retire. Replacement of an unreachable host requires new target/state after native revocation. Include explicit adoption and loss recovery; no reset shortcut.
- [ ] Add desktop connectivity example with explicit remote E2B execution label, cloud endpoint/TLS prerequisites and no promise of desktop-local project access. Verify environment names against actual config.
- [ ] Run renderer/static tests and Docker Compose config validation with nonsecret fixtures; commit with explicit paths.

## Task 5: Full slice verification, review and integration

**Files:** existing `docs/replatform/m4-code-execution.md` and the changed files above.

- [ ] Run a Linux Docker integration journey: distinct identities, contention before network, forced restart with identity continuity, missing established state refusal and retirement/old-generation denial. Reuse existing isolated enrollment test harness; no live E2B/model calls. Assert execution placement is a fixture, not desktop-local production proof.
- [ ] Run all changed-file focused tests. Run `pnpm.cmd -r typecheck`, `pnpm.cmd test:run`, and `pnpm.cmd build` serially with ordinary integration flags unset. Run targeted actual PostgreSQL and Linux lock cases separately with explicit opt-in flags; record skips and commands.
- [ ] Obtain one independent whole-branch review if native execution is chosen; fix confirmed findings with failing regressions and focused green checks, without repeating approval reviews for fixed findings.
- [ ] Update the M4 evidence matrix with exact source/test evidence, engineering gaps and environment prerequisites, including local-execution backend remaining separate. This slice cannot close M4 by itself.
- [ ] Open and attach PR against `docs/replatform-program`, wait for required CI, resolve failures, and merge only into that program branch under existing authorization. No main merge or rollout.

## Next subsystem after this slice

Prepare a separate concrete recovery plan covering actual CLI subprocess invocation,
isolated source/destination PostgreSQL, SQL/gzip round trips, migration metadata,
restored stale fences and object integrity/quarantine. Reuse existing Windows-safe
PG harnesses rather than enabling the database package's unsafe Windows embedded
shutdown fixture. Update the M4 HA/load matrix and address confirmed code gaps;
production timings/load and M3 external prerequisites remain visible.

## Execution handoff

Recommended: native implementation in this session, followed by one independent
whole-branch review. These tasks share the binding/ownership interfaces; keeping
implementation together reduces coordination overhead. User must review this
written plan and select execution method before product implementation begins.
