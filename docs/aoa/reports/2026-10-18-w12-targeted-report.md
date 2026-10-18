# W12 targeted worker lifecycle verification — 18 October 2026

## Result and scope

The independently authorized W12 engineering increment passes targeted Windows
and Linux VPS checks. It adds verification of the existing supported worker
retirement/replacement route; no product defect was demonstrated and no production
code, schema, wire protocol, rollout flag or legacy-adoption behavior was changed.
Full restored live-fleet acceptance remains open.

- Branch: `codex/w12-worker-lifecycle`.
- Implementation commit: `14abdff924985eec2652b1980e575ed18937593b`.
- Base: `1e1ec04c0d2705cfc6d29dd6216eb956fa7f3e56`.
- Worktree: `C:/Users/Dell/Desktop/aoa/w12-worker-lifecycle`.
- [Completed/pending checklist](../plans/2026-10-18-w12-handoff.md).
- [Portable evidence and source receipt](../evidence/2026-10-18-w12-summary.json).

Tests ran before the implementation commit. The portable receipt binds the base
archive and 26 selected test/production/lockfile/Dockerfile inputs by UTF-8/LF
SHA-256. Those inputs were checked against the implementation commit; a Git HEAD
alone would not identify the then-uncommitted test increment. The VPS archive has
no Git metadata, so its capture correctly leaves the Git SHA unknown rather than
inventing a checkout identity. W02/W05's later changes are not included by implication.

## Verification

Both hosts use Node 24.19.0 and pnpm 9.15.4. Windows PostgreSQL integration is
explicitly enabled with `AOA_RUN_WIN_INTEGRATION=1`; VPS tests run as non-root
`aoatest` with no provider credentials or personal authentication.

| Check | Windows x64 / Docker Linux | VPS Linux ARM64 |
|---|---|---|
| Frozen install and required dependency builds | Pass | Pass |
| Server + worker-daemon typecheck and build | Pass | Pass |
| Selected Vitest files | 12 files: 88 pass, 1 native opt-in skip | 12 files: 88 pass, 1 native opt-in skip |
| Linux slot + native restore wrapper | 4 pass | 4 pass |
| Nested native restore/object cases | 1 fence + 2 object cases executed | 1 fence + 2 object cases executed |
| Final snapshot assertion follow-up | 3 pass | Included in final selected suite |
| Separate worker image | `aoa-worker:w12-local` | `aoa-worker:w12-vps` |

The selected files cover slot binding/ownership/host; enroll-once; drain,
resumable drain and revoked poll component behavior; real-PG enrollment,
daemon-session lifecycle, revocation, re-enrollment and stale restored fences.
The exact list and executed command arguments are retained in the evidence JSON.
The one skipped main-suite case requires the owned native fixture; the separate
Docker wrapper executes it and both object-recovery cases. The nested cases are included
in the four outer tests and must not be double-counted.

Whole-repository tests, recursive whole-tree typechecks, the authoritative root
build and release campaigns were not run: this request explicitly selected
targeted verification. The package/dependency builds above are not a root-build
claim. Native stdout/stderr, exact exit receipts, JSON reports and hashes are
retained; raw logs and disposable private runtime state are not committed.

## Added evidence

1. **Enrollment authority:** an authenticated draining heartbeat changes the
   target to draining; revocation disables it, advances its generation and revokes
   its worker. The old session and consumed-code replay are denied. An old worker
   UUID cannot transfer to a new target. A fresh target/code/worker enrolls and
   authenticates while the old target stays disabled. This heartbeat assertion
   does not itself prove completed active-lease drain; separate poll components
   retain their own drain/shutdown coverage.
2. **Actual daemon clients over HTTP:** real enroll-once/bootstrap/renewal code
   talks to the real control-plane routes and PostgreSQL. Revoked authority is
   terminal even when identity/receipt survive a simulated boot. Fresh replacement
   stores successfully enroll, replay-bootstrap and renew. Stores are memory-backed;
   identity and receipt preservation use independent snapshots.
3. **Real Linux host processes and disk:** networkless non-root containers start
   separate guarded-host processes. Duplicate binding/state ownership refuses
   before injected bootstrap; keys and targets remain independent. SIGKILL frees
   ownership and restart retains exact identity. Missing identity, another target's
   identity or another incarnation refuses before bootstrap. Replacement state
   remains separate and restartable. Enrollment bootstrap is injected here.
4. **Native restore and quarantine:** the existing full-schema/native-client
   wrapper rejects post-snapshot/expired/generation-stale authority and admits fresh
   authority. Corrupt/missing recovered local object bytes remain quarantined,
   while a healthy sibling stays available. This is disposable DB/local-object
   fixture evidence, not external-store recovery or a continuous restored fleet.

## Isolation, review and earlier attempts

W12 used only `/opt/aoa-w12-20261018`, its separate dependency/build tree,
`aoa-worker:w12-vps`, and disposable test containers. Slot containers use the
opt-in `aoa.work=w12-20261018` label. Native restore uses random container IDs,
unique state and dynamically allocated loopback DB ports, stopping only its
recorded container. VPS TypeScript builds were serialized with the other chat's
heavy work to avoid exhausting shared RAM. No global Docker pruning was used.

The W02/W05 review service, public web listeners, Caddy/OAuth, shared DB and source
directories were not changed by W12. W02/W05 independently redeploys its own
review service; revision changes from that chat are not W12 side effects. Final
resource inspection is recorded in the portable isolation receipt.

Sol/high agents handled authority and slot coverage; Luna/high handled the daemon
session case; a separate Sol/high reviewer checked code and completion claims.
Review found no blocking behavior/security issue. Its snapshot finding was fixed:
an initial `structuredClone` comparison exposed Buffer/Uint8Array representation
differences, then an independent byte snapshot passed the focused rerun. Fresh
worktree setup also required compiled dependencies, pinned pnpm and Windows POSIX
build tools; unsuccessful setup attempts remain preserved, not classified as
product defects or substituted for passing evidence.

## Remaining acceptance

The selected migration is **drain → revoke/retire → new target/code/binding/state**.
Legacy adoption is not selected. Before closing W12's full live gate, run one
continuous deployed journey after an actual authority restore: old authority
cannot resume governed effects or ordinary commits; operator-provisioned
replacement performs useful governed work; orphan outputs stay reviewable
quarantine. Separate passing boundaries above are not that continuous journey.

W14/W15 additionally require expanded topology, actual failure domains, external
stores and measured recovery timings. This increment does not establish fleet HA,
RPO/RTO, production rollout, model execution or desktop-local subscription support.
