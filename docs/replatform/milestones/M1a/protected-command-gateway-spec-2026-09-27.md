# M1a Protected Command Gateway Specification

Status: proposed written design for user review, not implementation or activation
approval. First operational subproject of the existing-server wave. TK is the
appointed accountable Integration/Security and RET owner. M1a remains FAIL.

## Purpose And Boundary

Replace direct campaign Docker access with an independently controlled command
gateway on the selected existing server. Reuse reviewed image-policy/start-guard
checks without relabeling their TEST authorities as production. Candidate
processes are untrusted, including build scripts, harness scripts and exec
payloads. The gateway never interprets candidate shell text on the host.

This subproject delivers gateway protocol, durable dispatch semantics, authority
verification interfaces and consumer migration. It does not appoint the verifier,
provision accounts/daemons, admit images, sign policies, upload raw evidence or
dispatch a campaign. Those are later activation prerequisites, not hidden defaults.

## Selected Architecture

The gateway owns a dedicated campaign daemon endpoint, inaccessible to candidate
users and processes. The existing shared Docker daemon and running services are
not modified. The controller binary, public-key pins, profiles and state directory
are protected from candidate writes. Candidate execution has no sudo, Docker
group, privileged devices, host namespaces or daemon sockets. A PATH wrapper or
rootless daemon whose socket is given to the candidate does not satisfy this.

The host audit establishes capacity observations, not containment. Signing keys,
archive credentials and verifier credentials remain outside candidate custody.
No shared-kernel escape resistance is claimed from namespaces alone. Match the
actual program threat model and prove the chosen operating-system restrictions
before activation; do not invent a new program requirement or waive an existing
one. Lack of a usable boundary refuses activation, not protocol development.

## Typed Protocol

Use a versioned, closed JSON request over a local authenticated Unix socket.
Reject unknown fields, malformed UTF-8, duplicate JSON keys and requests over
64 KiB before dispatch. Authenticate the peer from operating-system credentials,
not a caller-supplied user identifier. A peer is bound to one controller-created
campaign session and cannot select another session's project or resources.

Each request names protocol version, session, unique operation ID, operation,
reviewed service targets and operation-specific arguments. Session configuration
is controller-owned: exact candidate/controller revisions, admitted image and
container bindings, service/dependency profile, policy hash, authority roots,
expiry/revocation source and resource limits. None are loaded from request paths.

Allowed semantic operations: create, up, run, start, restart, exec, unpause,
stop, kill, remove, inspect, bounded log retrieval and apply-rollout. Wire these to fixed
gateway-owned Docker argument construction, never caller-provided argv,
Compose files, environment overrides, shell commands or arbitrary API endpoints.
Reject build/pull/tag fallback and automatic restart policies in the runtime
profile. Credential-free build/inspection remains a separately approved phase.

Run/exec payloads are candidate bytes, not trusted programs. Accept them only
under an explicit reviewed payload capability and bound byte/resource limits,
inside an admitted target container; never execute them in the gateway process
or host shell. Until that capability is configured, refuse run/exec. Inspect and
logs return only profile-approved fields/streams into private collection, not
arbitrary container environment values or public Actions output.

## Admission And Dispatch

Serialize each session's inspect/check/dispatch sequence and prohibit alternate
daemon actors. Resolve dependency closure from the protected service profile;
keyless closure must never contain adapter-manager. Check each image's actual
identity kind without equating Docker config IDs and OCI manifest digests.
Existing-container operations verify actual container/image/replica bindings.
Use no-build/no-pull options and explicit admitted targets.

Immediately before every execution-capable operation, verify authenticated policy,
candidate/session/profile bindings, fresh trusted time, expiry and revocation.
Refuse unavailable clocks/revocation, stale policy, substitution or partial
inventory. Cleanup authority is separately scoped: expired execution authority
cannot authorize new work, but must not strand cleanup. Cleanup is restricted to
the controller's recorded campaign resources; no general daemon administration.

Provider sandbox creation is not Docker admission. Real E2B creation remains
disabled until its separately reviewed pre-create identity contract is supported
and approved. This subproject cannot clear the keyed lane by checking local images.

## Durable Outcomes

Persist accepted operation ID and request hash before side effects in a private
controller-owned journal. States are accepted, dispatching, observed-success,
observed-failure and outcome-unknown. Reusing an ID with changed bytes refuses;
reusing identical bytes returns the known outcome, never repeats the operation.

Crash or timeout after dispatch starts yields outcome-unknown. Reconcile against
actual labeled resources and recorded identities; do not automatically retry a
possibly successful operation. Freeze new session execution during unresolved
outcomes. Record authentic exit status, cleanup observations and uncertainty.
Persist terminal records before acknowledging completion. Candidate disconnect
does not erase state or imply cancellation/cleanup success.

Collector integration consumes these observations as untrusted evidence, not a
gate verdict. Raw streams stay private from their first byte. Unsupported,
missing, oversized or skipped required evidence refuses completeness; preserve
existing archive schema and size limits rather than silently truncating.

## Repository Integration

- Add gateway protocol/dispatcher/journal modules and focused tests under
scripts/lib, following current ESM helpers and structured validation patterns.
- Adapt scripts/m1-shipped-boot/journey.mjs at its compose dispatch and direct
  inspect paths. Preserve source-built object-store and shipped-boot semantics.
- Adapt tests/d1/lib/e6f-harness.mjs start/restart/exec paths, including fault
  injection. Inventory all executable Docker paths before claiming coverage.
- Keep existing TEST helpers and tests valid. Production wiring requires a new
  authority loader, not an exception to their explicit production refusal.
- Add only offline ordinary-PR tests initially. Do not activate deployment,
  provider, archive-upload or campaign workflows as part of source verification.

### Presign Probe And Rollout Transitions

The current presign probe overrides the adapter-manager entrypoint with Node in
both modes; its application binary does not start. Nevertheless the gateway's
keyless profile forbids that service/image execution, not merely provider calls.
Replace this with a separately admitted disposable probe target in the new
profile. It must reproduce the relevant DNS/network/CA trust path without
adapter-manager application code or provider credentials. Record the distinct
probe identity and what it proves; do not label it evidence of running the
adapter-manager. Keyed probes may use a gateway-managed disposable admitted
container with reviewed entrypoint, mounts and environment. The gateway records
creation/removal identities and cleanup; run is not restricted to containers
that already exist, but every created container derives from an admitted target.

The current applyRollout derives tenant IDs and rewrites rollout environment.
Introduce an explicit controller-owned apply-rollout transition rather than
allowing arbitrary environment overrides. Validate enabled/control tenant IDs
against the session's independently observed setup results and reviewed tenant
roles, construct only the existing rollout policy field, and retain the control
tenant exclusion. Reject unknown, cross-session or duplicate tenant identities.
Sequentially recreate the two reviewed control-plane replicas with unchanged
admitted images, rechecking authority before each operation; record configuration
hash and replacement container bindings. Partial or unknown transitions freeze
new execution for reconciliation. No caller-supplied Compose or general env
changes become permitted by this operation. These profile/configuration changes
require replacement freeze review and new candidate evidence.

## Required Verification

Protocol tests reject unknown/duplicate fields, caller-selected authority and
paths, unauthorized peers/sessions, replay with different bytes and oversized
payloads. Dispatch tests prove complete dependency closure, wrong image/container
refusal, expired policy after waits, no implicit build/pull, scoped cleanup and
unknown-outcome recovery without repeated side effects.

Linux boundary tests, under a separately approved non-sensitive deployment,
must demonstrate that candidate code cannot reach either Docker socket, rewrite
controller/policy/state, read approval/archive credentials, request privileged
mounts or cross campaign sessions. Unit mocks do not prove that boundary.

Migration tests enumerate every direct start/restart/run/exec path and preserve
actual harness behavior. Full typecheck, tests, build and exact-head CI are
required before source integration. A new reviewed candidate/freeze is required
before campaign execution; historical refs and immutable QA are unchanged.

## Review And Activation Decisions

Written-spec approval permits a task-by-task implementation plan only. The plan
must fix exact wire schemas, journal durability implementation, payload limits
and file ownership boundaries before code. User-selected subagent implementation
and independent review remain the intended method after written-plan approval.

Before deployment, TK and independent reviewers must approve the actual account,
daemon/socket, execution isolation and authority custody configuration. A named
independent verifier and exact-byte archive permission are required by the later
evidence wave, not invented here. No new machine, cleanup, spend, signing or live
campaign is authorized by this document.

## Independent Specification Review

Poincare `01a0e3f4-e0e9-7fe2-a26f-2f879b16e9c6` found two P1
migration contradictions in the initial draft. Parent verified the source and
added the explicit probe and rollout transitions above. Scoped rereview found
both resolved and no new specification blocker. This supports written-spec
review for detailed-plan preparation only, not production activation or M1a
clearance. No runtime code or host configuration changed in this wave.
