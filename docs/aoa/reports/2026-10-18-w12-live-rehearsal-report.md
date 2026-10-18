# W12 isolated live rehearsal — report, 18 October 2026

## Current verdict

The isolated rehearsal reached a **real distributed E2B job** with a networked
worker and the supplied OpenAI credential, but it has **not** met the W12 live
acceptance gate. The Codex CLI exited 1 before producing an output; the job
had zero committed outputs. An owned database and object-store restore, followed
by pre-serving revocation, succeeded. Old-session denial and useful replacement
work remain unproved; normal control-plane startup after restore refused its
app-authority check until an isolated manual diagnostic repair.
The full restored-fleet and production-readiness acceptance gates remain open.

The run used the frozen combined candidate
`eed114e7c25fef2f7a34fb57a1d6df3150b90c69` (application
`0896c43961d2e19e2c7fd163f32c51c6e69d0889`) in the separate
`codex/w12-live-rehearsal` worktree. Other-chat fixture commits
`41f2c2a` and `fdf1f5a` are **not** part of this frozen application base.
No production runtime code, schema, wire protocol or shared review deployment
was changed for the live attempt.
The [portable live evidence summary](../evidence/2026-10-18-w12-live-summary.json)
records the owned command and isolation receipts for review.

## Isolated apparatus and chronology

The VPS rehearsal owns `/opt/aoa-w12-live-20261018`, Docker
project/label `aoa-w12-live-20261018`, PostgreSQL and HTTPS MinIO on
loopback ports 25432 and 29000, and private control-plane and adapter-manager
listeners on 33120 and 38090. A real E2B template was built from the
repository Dockerfile and pinned as
`g31y4dxpd4c8ufmoum40:9bad01cc-576f-46aa-88a8-62ce1a8253f3`
(envd runtime `0.10.0`, Codex CLI `0.163.0`). The guarded networked worker has a private
per-target identity, slot binding and state directory. The control plane,
adapter manager and worker ultimately ran the **candidate source through
tsx**; initial copied `dist` artifacts were stale and were corrected before
the distributed attempt. The adapter manager's account-wide reaper was kept
off; cleanup of this rehearsal's exact sandbox IDs is operator-scoped.

The private `cloud_auth` control plane used its loopback-only guarded E2E
session-mint seam, rather than shared Google OAuth. The session proves private
API authorization for this rehearsal, not real Google authentication. The
company has an encrypted OpenAI secret and a default company E2B runtime key.
The adapter manager alone carried the ambient `E2B_API_KEY`; the OpenAI key
was delivered through governed secret redemption. An active company E2B
environment was pinned for the task, allowing the normal
provider-sandbox acquisition to pass the cloud isolation guard without the
insecure unsandboxed override. Its acquisition precedes the distributed
handoff, so this route can create a separate short-lived S5 sandbox in
addition to the worker's job sandbox.

Three early task attempts did not establish a distributed run. Two lacked the
E2B environment and were refused by the cloud unsandboxed-execution guard.
The third had that environment but lacked the required legacy-reconciliation
preflight; its legacy fallback failed with `EACCES` before any model execution.
Those are failed admission/setup attempts, not successful jobs or completed
reconciliation evidence. The real operator reconciliation was then completed
and the fourth task entered distributed execution:

| Record | Identifier |
|---|---|
| Organization | `e1aed02b-9f77-4df0-b893-b7e3208996f9` |
| Company | `f0cbb6d6-7d02-48fb-9c85-594486c47422` |
| Agent | `c3374820-9301-46fd-865b-3d91378f23c7` |
| Target / worker generation | `d7741160-3314-4579-8517-77b0c355517c` / `9cce2001-8f6a-454f-a7aa-430d3ffc7ba7`, generation 1 |
| Task / heartbeat run | `1a372c33-f1d1-4387-9ce9-c503978a22aa` / `ce704369-2329-4009-b625-312bdd816650` |
| Job / attempt / lease | `b5bbaccf-748f-412d-8de2-15ab43b41327` / `f420c6f7-fa69-4ae1-b7a0-0b8a098945a6` / `c11b5d71-4bcd-478b-be83-9b36ca7ddf3d` |
| Job sandbox | `iwir7tvxz9xrrgkk6sy6p` |

The real worker reported a clean environment probe, and the OpenAI key was
redeemed into the sandbox. The CLI then exited 1, with zero outputs; cleanup
of the first job sandbox reported success. At that observation the job still read
`running` despite a failed attempt and active lease. It must not be presented
as a terminal successful job. A direct diagnostic using the same CLI,
template and environment got HTTP 401 for a missing bearer. A positive
control after CLI stdin login succeeded and returned `W12_OK` with 13,197
input tokens and 7 output tokens. This supports an authentication-bootstrap
gap in the distributed invocation, rather than a rejected OpenAI key. It does
not establish that the actual distributed job completed useful work.

## Actual owned restore and pre-serving cutoff

The rehearsal's control plane, adapter manager and worker were all stopped
before the native SQL.gz backup. The backup completed at 02:02:03Z, was
187,791 bytes, and had SHA-256
`4905880302667e4b0879ec29f2354541e6775ec31a60171f85f82be745bb3671`.
MinIO was stopped before its 02:02:16Z snapshot, which was 79,872 bytes
with SHA-256
`5f5be3c89e9589e4cc19b78bfca8d9f359907f5b2d30ba2a589ea85a2bf4d53f`.
The object snapshot was restored into a **new owned volume**,
`aoa-w12-live-20261018-minio-restored-data`; the old volume was retained.
The native database restore succeeded and migrations were checked.

Before serving the restored application, the real `revokeExecutionTarget`
operation disabled the old target and advanced its device generation from 1
to 2. Offline fanout reported one record, one revoked lease, one cancellation
and one completed item; the wait converged to completed. External S3
reconciliation inspected two restored committed **input** artifacts, verified
both, and blocked none. There was no useful output in the failed job, so this
reconciliation cannot prove output quarantine or orphan-output reviewability.

Capturing an old worker session failed with HTTP 401 **before cutoff** because
the code route's ten-minute window had expired. No valid pre-cutoff JWT was
retained. Consequently, this rehearsal has not shown that a retained old
session is denied after restore. The durable generation/revocation result and
offline fanout are real, narrower evidence; they do not substitute for that
missing session test.

The **unassisted** normal candidate-source control-plane boot after native
restore refused at `distributed_execution_app_authority`, phase
`app-authority`. Read-only diagnosis found non-owner, serving-role authority
and security-definer manifest checks passing; the catalog certificate failed
on relation ACLs. The restored `execution_targets` and `mcp_api_keys` tables
had NULL `relacl`, while the manifest requires non-NULL owner-only ACLs.
Security-definer ownership drift was ruled out. The service stayed stopped;
the replacement HTTP probe got **connection refused**, so no replacement
target API call or enrollment completed at that point.

Separately, an operator ran a **manual diagnostic normalization** on this
owned scratch database: `REVOKE ALL ON TABLE public.execution_targets,
public.mcp_api_keys FROM PUBLIC`. It did not revoke serving-role column
privileges. The unchanged full catalog certificate passed in the transaction
before commit, and all four normal app-authority checks passed afterward.
The normal control-plane boot then **succeeded**. No product source or
certificate was changed. This manual intervention does **not**
make the unassisted native restore a passing acceptance path.

After that boot, an actual duplicate fixed-canary-slug API request returned
HTTP **409**. An operator created and ratified a distinct target
`45ca62df-c6cb-4d9e-b3e6-19addb9f23c2` with slug
`w12-replacement-e2b`. A real guarded daemon enrolled as worker
`517dd69a-9f65-4e2e-8cf2-b6e4ba6e35ee`, generation 1, with distinct
state, slot and key (new thumbprint prefix `61daf`, old `eba693`). It
acquired a session and composed polling. This establishes fresh worker
authority, **not** useful replacement execution: a read-only call to the
actual `chooseExecutionTargetRow` path using `resolveCanaryCredentialBinding`
and the API target rows returned `null` (old fixed-slug target disabled at
generation 2, new-slug target active at generation 1). No placement SQL or
new governed task was issued to that replacement.

Final observation of the original distributed job showed two **failed**
attempts: `f420c6f7-fa69-4ae1-b7a0-0b8a098945a6` and automatic retry
`9a366353-6496-4c3e-a34e-464bc098b101`. Its original lease
`c11b5d71-4bcd-478b-be83-9b36ca7ddf3d` expired; retry lease
`fadd0431-3127-4ec3-9d76-c90532a5d94c` was revoked by offline fanout.
The job converged to **cancelled** with zero useful outputs. Both owned job
sandboxes (`iwir7tvxz9xrrgkk6sy6p` and `i8vizw6qfsmgg986xz0no`)
reported successful cleanup.

## Verification and limits

The rehearsal API helper's five mock HTTP tests passed on Windows and on the
VPS (5/5 on each). They cover the governed hire/approval path, stateful
idempotence, origin and secret handling, error redaction, and exact-byte
download refusal. These are helper tests, not a substitute for the failed
live output. The full repository suite and authoritative root build were not
run for this targeted user-authorized rehearsal. The prior W12 targeted
report retains its separate Windows/Linux fixture, native restore and build
results; those results do not convert this attempt into a passing live gate.

## Final host cleanup and isolation

At 02:09:29Z the owned control plane and worker were stopped (the adapter
manager had already stopped), and the exact owned PostgreSQL and MinIO
containers were stopped and removed. The final owned-host scan found zero
running containers, no owned processes and no listeners on ports 25432,
29000, 33120, 38090 or 39128. Three owned labeled volumes, private config,
backups and source were retained for follow-up; they are not running
resources.

The shared review unit had the identical before/after PID `301667`, active
since 01:24:50Z, with unchanged `ExecStart` and drop-ins. The shared database's
full container identity and `StartedAt` were identical before and after;
shared health returned HTTP 200. Final provider inventory also found zero active or paused sandboxes for the
owned template, which is retained for follow-up. An unrelated paused sandbox
was left untouched.

## Remaining evidence to complete

- [x] Stop owned control-plane, adapter-manager and worker processes; take
  native database and stopped-MinIO snapshots, restore the database and a
  new owned object volume, and check migrations.
- [x] Before restored serving, revoke the old target (generation 1 to 2,
  disabled), complete offline fanout and reconcile two committed input
  artifacts with zero blocked. These checks establish neither output
  quarantine nor post-restore old-session denial.
- [ ] Capture a valid old worker session at a supported time and demonstrate
  its denial after a comparable cutoff; the attempted pre-cutoff capture got
  HTTP 401 and yielded no usable JWT.
- [ ] Demonstrate that retained old worker identity/receipt and lease cannot
  renew, resume effects or make ordinary commits after restore. The completed
  offline lease revocation is one part of this broader live denial gate.
- [ ] Fix and regression-test the native restore of explicit owner-only ACLs
  so the unchanged application certificate passes without a manual repair. A scratch-only ACL normalization made the unchanged
  certificate and four app-authority checks pass and normal boot succeeded.
  Do not treat that manual repair as product restore acceptance.
- [x] Reproduce duplicate fixed-canary-slug HTTP 409 and provision a distinct
  replacement target/code/binding/state. Real daemon enrollment, session and
  polling composition succeeded with a distinct key and slot.
- [ ] Place a governed job on the replacement and obtain a committed output
  with exact-byte download. The actual chooser returned `null` for the
  active new-slug target while the fixed-slug old target was disabled; no
  replacement task was submitted through an unsupported placement route.
- [x] Stop and remove exact owned running host resources; verify zero owned
  containers/processes/listeners and unchanged shared review unit/database
  identity with health 200.
- [x] Complete final provider inventory: zero owned active or paused sandboxes;
  retain the named W12 template and leave unrelated resources untouched.

W14/W15's expanded topology, real failure domains and measured external-store
recovery remain separate acceptance work.

## Next bounded work

Fix the distributed Codex authentication bootstrap using the supplied company
credential inside the sandbox, then repeat the useful-output path. The
[official CLI authentication procedure](https://learn.chatgpt.com/docs/auth)
uses API-key login through stdin; the diagnostic followed that procedure.
Preserve CLI-only model execution and secret-scanning boundaries.

Fix native restore to retain the exact catalog certificate, including explicit
owner-only relation ACLs, and add a native restore-to-normal-boot regression.
Provide a supported successor canary routing contract that preserves immutable
placement replay. Then repeat the continuous journey with a valid old session
captured early, old-lease/effect/commit refusals, useful replacement output,
exact-byte download, and output quarantine. These fixes and the isolated repeat
can proceed independently of the W02/W05 review deployment.
