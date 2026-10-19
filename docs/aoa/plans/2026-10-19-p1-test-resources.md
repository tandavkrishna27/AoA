# P1 shared test hosts, reservations and cleanup

Recorded from the user's 19 October 2026 instruction. The Windows computer running the chats and the testing VPS are available for bounded functional application tests. Docker and standard development tooling are reported available on both; verify actual versions, free resources and prerequisites at pickup. This documentation update did not connect to or change the VPS.

## Available hosts and access

| Host ID | Purpose | Access |
| --- | --- | --- |
| `local-windows` | Windows PC, Docker Desktop Linux containers, local functional app/worker tests | Current developer computer; repository `C:\Users\Dell\Desktop\aoa\AoA` |
| `testing-vps` | Linux functional app/worker tests, remote authority and paired PC/VPS journeys | SSH command below, from Windows |

```powershell
ssh -i "C:\Users\Dell\.ssh\aoa-testing" root@2.28.28.156
```

The key path is an access reference, not permission to read, print, archive, copy or commit the private key. Preserve the key, existing CLI login stores, protected configuration, shared tooling and unrelated applications. Use normal SSH host-key verification; do not disable it or overwrite known-host identity after an unexplained change. Report an unreachable host or missing credential instead of altering access controls.

The address does not imply an old installation, port, database or namespace is disposable. Inventory the actual host before setup. These two physical hosts are sufficient for narrowed functional P1; do not provision another VPS, expanded staging, HA infrastructure or load/soak campaigns.

## Resource admission: central owns both hosts

Disk, RAM and CPU are constrained on both machines. Parallel coding does not authorize parallel heavy runtime tests. **Default: one heavy test/build batch per physical host at a time**, including Docker builds, app/worker/database/browser stacks and memory-heavy package test/build commands. This is a conservative admission rule, not a measured performance claim. Small read-only documentation/source checks can proceed without a heavy-host booking.

Before heavy setup, the lane requests a booking from central specifying ticket/chat, exact source commit, host(s), expected resource/disk use, services/ports, functional commands, duration and cleanup owner. Central checks free disk/RAM, existing processes/containers and reserved budgets, then grants a bounded booking or queues it. Keep conservative OS/editor/Docker/SSH headroom. If demand/headroom is unknown, serialize and measure the smallest setup first. Pause before allocating more when headroom is insufficient.

Within the booking, explicitly bound test-runner worker/process counts and Docker CPU/memory/PID limits to the granted budget; do not let an internal default fan out across all host cores. Include child databases, browsers, watchers and build helpers in the same budget. Serialization of top-level chats alone does not bound their descendants.

Independent batches may run on different hosts. A PC/VPS journey needs a **paired booking on both hosts**, granted before setup; do not hold one indefinitely while waiting for the other. Prefer keyless/unit checks first, one reusable candidate build, and the smallest real application journey proving the changed boundary. Do not start another full application for a check that can sequentially reuse the same owned, unchanged candidate.

## Host-global coordination and locks

Branches/worktrees isolate source edits, not host resources. Every P1 chat and resumed run uses the same physical-host roots:

- Windows coordination: `C:\Users\Dell\Desktop\aoa\.p1-coordination\`.
- Windows disposable runs: `C:\Users\Dell\Desktop\aoa\.p1-runs\<run-id>\`.
- VPS coordination: `/root/aoa-p1-coordination/`.
- VPS disposable runs: `/root/aoa-p1-runs/<run-id>/`.

Create these only when execution begins. They are outside Git, not assumptions of empty directories or permission to erase prior contents. Central owns the local `state.json` and mirrors relevant booking facts to each host; lanes do not race independent JSON rewrites. Operational state and secrets never enter commits.

Back each host booking with an actual exclusive OS lock or atomic create-with-refusal ownership marker in its coordination root. Hold/maintain it for the full heavy batch; a chat message/table entry alone does not exclude another process. Record holder process/start identity or equivalent lock authority, chat, run ID, source, creation/heartbeat time and resource manifest. Use one booking writer and unique per-run result receipts. A process-local flag or marker inside a different Git worktree cannot protect the shared host.

Before crash recovery/takeover, inspect the actual holder, owned descendants, Docker resources and latest receipt. Marker age or an ended SSH command alone does not prove the app is gone. Do not steal active locks or remove stale-looking markers blindly. If ownership or cleanup cannot be proved, keep the booking unavailable and report the blocker. Reconcile actual host state before issuing new bookings after a coordinator restart.

## Isolate every run and writer

Use a unique normalized ID such as `p1-provider-p1-02-<timestamp>-<random>`. Central records:

| Resource | Isolation and receipt |
| --- | --- |
| Checkout/build | Exact commit, dedicated worktree/disposable source export, independent writable build/output paths |
| Docker | Unique Compose project, container/network/volume names, task image tags, labels `aoa.p1.run` / `aoa.p1.owner`, actual IDs |
| App/worker | Dedicated homes/config/identity/outbox/log paths; no other lane's default instance |
| DB/storage | Dedicated disposable cluster/container and data/object namespace; no shared migration, role/ACL mutation, reset or restore |
| Ports | Centrally recorded allocations checked against actual listeners; dynamic binding/captured selected ports where supported |
| Processes | Exact owned parent/child and creation identities, explicit shutdown/abort path |
| Evidence | Per-run captures with exact source, commands/native exits, resource manifest and cleanup receipt |

Do not concurrently reuse writable application directories, databases, buckets/prefixes, worker identities, fixed ports, `.env`, generated migration directories or log files. Unique Compose names do not isolate a shared bind mount or hard-coded host port. The scheduler lane remains the sole generated-migration writer.

Reuse existing toolchains, package download caches and pinned base images safely. Avoid a full dependency installation/build per chat. Shared caches need one mutation owner or supported tool locking; do not share writable `node_modules`/outputs across different candidates. Reuse immutable builds only with exact source/runtime identity. Central records and budgets retained shared candidates/caches; other lanes cannot prune them.

## Cleanup is part of every batch

The user's instruction authorizes teardown and deletion of **new, uniquely owned disposable P1 test resources** after their work, including failed/cancelled/timed-out runs. It does not authorize deleting unrelated resources, permanent auth, source work or shared tooling. Register cleanup before launch and use `finally`/equivalent abort handling. Routine owned cleanup requires no further permission question.

1. Close new admission; drain/cancel owned tasks; stop app/watch/browser processes and await actual owned process-tree exit. Reuse graceful PostgreSQL shutdown and surface stop errors. Assertion completion or SSH disconnect is not teardown.
2. Remove only the recorded Compose project and verified owned containers, disposable volumes/networks and object prefixes. Check labels/IDs. Remove task image tags and disposable builders/caches only after central confirms no other booking needs them. Preserve approved shared/base caches.
3. Retain the minimum required redacted results/raw receipts, source identity, manifest and cleanup observations in a compact private archive outside the disposable root. Verify the archive/hash before deleting captures. Exclude keys, auth homes, plaintext credentials and bulk dependencies/build caches. Commit only safe reports/artifact references. Evidence archives also count against disk budgets.
4. Remove owned disposable source copies, duplicate dependency installs, generated output, temporary DB/object files, ephemeral credential activations and temporary configs. Preserve underlying personal login/keychain custody. Active worktrees/uncommitted work are not disposable test roots; use supported worktree archive/removal after preserving needed commits/files.
5. Before recursive deletion, resolve the exact absolute target and verify it stays within the recorded disposable run root. Verify retained evidence is outside that target. On Windows use native PowerShell literal-path operations end-to-end. Never delete a parent coordination/run root, active worktree, shared cache or an unchecked computed path.
6. Independently inspect owned listeners/processes, Docker resources and run directories; compare disk use with the pre-run inventory. Record removal/residue. Only then release the booking/lock. Expected outcome: zero owned runnable resources and no unneeded disposable footprint; any retained compact evidence/shared cache is named and budgeted.

No global Docker/system prune, blanket process kill, broad deletion or another lane's teardown. A failed cleanup or automatic approval rejection is a reported blocker, not permission to bypass it through another shell/path. Preserve ownership/evidence receipts and request only the specific unresolved action if necessary.

Do not report clean completion with owned services or unexplained residue. Keep the booking `cleanup_pending` and stop new heavy allocations on that host until central resolves it or explicitly accounts for safely retained non-running data. Never let old cleanup delete a new run's resource with a reused name, PID or port.

## Required dispatch and return fields

Central dispatch includes booking ID, approved hosts, exact run roots/Compose project, port/resource budget, shared resources to preserve, functional commands and cleanup owner. The lane returns actual manifest, native results, compact evidence/hash, cleanup receipt, residuals and booking release state. Test assertions without that handoff do not complete the batch.

## Scope

This records user-supplied infrastructure, cleanup direction and collision-avoidance rules. It is not a measured inventory, connectivity test, additional paid-provider authorization or instruction to start testing just by reading. The [test policy](2026-10-19-implementation-test-policy.md), [P1 queue](2026-10-19-p1-local-worker-fleet.md) and [orchestration guide](2026-10-19-p1-orchestration.md) define readiness and functional scope.
