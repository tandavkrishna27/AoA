# P1 multi-chat orchestration and launch prompt

Prepared 19 October 2026 for `docs/replatform-program`. This is an optional execution workflow, not a product architecture change or an instruction to start chats whenever this file is read. The human activates it with the launch prompt below. Publishing it does not start P1 work, qualify credentials or grant messaging/deployment authority.

## Read and preserve

Read repository `AGENTS.md` and its required architecture sources, then:

1. [Replatform workspace README](../../replatform/README.md).
2. [P1 design and W01-W17 reuse ledger](../../replatform/design/2026-10-18-central-vps-local-batch-fleet.md).
3. [Seven-ticket implementation plan](2026-10-19-p1-local-worker-fleet.md).
4. [Implementation-phase test policy](2026-10-19-implementation-test-policy.md).
5. [Shared local/VPS test hosts, access, reservations and cleanup](2026-10-19-p1-test-resources.md).

The seven-ticket plan owns implementation scope and acceptance. This guide owns delegation, communication, worktree boundaries and integration. Recheck current HEAD and newer handoffs at startup. Reuse landed W01-W17 work. Keep security, tenant scope, quotas, fences, cancellation, durable completion and cleanup checks active; performance/load/latency/soak qualification stays deferred and whole-suite verification stays in GitHub CI.

The user provides the local Windows computer and testing VPS at `2.28.28.156`, both with Docker/dev tooling reported available. SSH access and protected key-path reference are in the shared-host protocol. Central schedules physical-host bookings separately from code tickets: one heavy functional test/build batch per host by default; paired journeys reserve both hosts. Lanes cannot start app/DB/Docker setup without a booking, and cannot release it before verified owned teardown. Use host-global locks plus isolated run IDs, paths, ports, databases, Compose projects and receipts. Keep resource-heavy tests serialized even while coding lanes run in parallel.

## Models and responsibilities

| Role | Model setting | Responsibility |
| --- | --- | --- |
| Central command | `gpt-6-astra`, reasoning `high` | Dependency graph, P1-01 boundary review, dispatch, shared-interface decisions, code/security review, integration and final verdict. |
| Provider lane | `gpt-6-sol`, reasoning `high` | P1-02; later P1-04 as the single integration owner when dependencies are ready. |
| Credential lane | `gpt-6-sol`, reasoning `high` | P1-03; supply reviewed credential interfaces and fixes needed by integration. |
| Scheduling/recovery lane | `gpt-6-sol`, reasoning `high` | P1-05 then P1-06; exclusive ownership of shared admission, attempt schema, migrations, quota/reservation and retry changes. |
| Documentation checker | `gpt-6-luna`, reasoning `high` | Read-only documentation, requirement/evidence mapping, references and claimed-result checks. Return actionable corrections to the lane. |

These names deliberately mean **Sol (`gpt-6-sol`)**, not an automatic upgrade to `gpt-6.1-sol`. If a named model/effort is unavailable, report it and obtain a human choice instead of substituting silently. Set both model and effort through the actual supported chat/subagent creation settings. A prose role description does not change the current chat's model. The human should select Astra High before submitting the central launch prompt.

A Sol lane chat is itself the implementer. Use additional Sol High subagents only for independent bounded implementation/test tasks with exclusive files. Use Luna High subagents for narrow documentation checks. Avoid an extra coordinator layer in every lane. Respect the runtime's actual concurrency and model-override support; do not assume unlimited nested workers or shared capacity across independent chat sessions.

Luna does not approve concurrency, database migrations, credential isolation, code correctness or security. Central Astra reviews those changes, using fresh Sol High code-review help when useful. Documentation feedback cannot turn a missing or skipped functional check into a pass.

## Activation and initial qualification

1. Verify the human launch instruction authorizes this run, lane creation, messaging, models and separate worktrees. Do not infer those permissions merely from this file.
2. Discover the actual project, coordinator chat ID and available capabilities. The Codex app exposes distinct chat creation/read/message/wait tools; subagent collaboration tools are separate. Do not fabricate IDs, unavailable tools or a shared-memory bus.
3. Establish a reviewed base from the current `docs/replatform-program` commit. Keep unrelated working changes intact. Record source identity and the plan revision.
4. Execute **P1-01 first**, with a bounded Sol High qualification worker and Luna High document check as useful. Central Astra owns its decision. Existing broker types and a vendor proxy option are not proof of a working protected subscription boundary.
5. If P1-01 cannot demonstrate the required mode, record the precise limitation and request the required human scope/security decision. Both credential modes remain P1 requirements. Do not launch the dependent implementation lanes against an assumed interface.
6. After the qualification/interface review, create the three Sol High lane chats and independently owned worktrees, or attach specifically user-designated existing lane chats. Start them from the recorded reviewed base including P1-01.

## Lane ownership and dependency graph

```text
P1-01: qualification and interfaces (central owner)
  |
  +-- provider chat:     P1-02 --------+--> P1-04 --+
  |                                  |           |
  +-- credential chat:   P1-03 --------+           +--> P1-07
  |                                              |
  +-- scheduling chat:   P1-05 --> P1-06 ----------+
```

P1-06's deterministic repository tests can follow P1-05 while P1-04 integrates. Actual runtime recovery tests also require P1-02/P1-03. P1-07 consumes both reviewed integration outputs. Central assigns its final acceptance implementation to one Sol owner and retains final review.

| Lane | Exclusive change ownership | Exchange through |
| --- | --- | --- |
| Provider | New Docker provider, adapter-manager/provider composition, worker node packaging, provider tests | Existing `SandboxProvider`; P1-01 boundary/profile; reviewed commit |
| Credential | Device broker, authorized activation/deadline/streaming integration, credential tests | Existing reference-only activation interface; reviewed commit |
| Scheduling/recovery | `job-control.ts`, `job_attempts.ts`, generated migration, source/admission/waiting/placement/quota/reservation/retry integration, fleet selection/status UI | P1-05 internal evaluator and trusted policy; reviewed commit |
| P1-04 integration | Actual task-run staging/output joins and pinned local useful-work journey | Provider + credential commits already integrated into its worktree |
| Central | Coordination ledger, source identity, dependency release, cross-lane review, program branch integration and final support claims | Validated handoffs and integration commits |

For overlapping shared files, stop the second writer and assign a single owner before editing. A doc checker requests corrections rather than editing a lane's working tree concurrently. Native subagents inside a lane share that lane's filesystem unless explicitly isolated; separate top-level lane worktrees do not automatically share file edits or commits.

## Worktrees and integration

The launch prompt authorizes separate worktrees. Use project tools to select the existing AoA project, and explicitly start from `docs/replatform-program`, never an implicit default/main branch. In lane creation, set `model` and reasoning effort as above and verify the returned checkout/base.

Use exact authorized branch names `codex/p1-provider`, `codex/p1-credentials` and `codex/p1-scheduling`; reuse a matching suitable worktree when present. If an existing branch contains unrelated work, report it before repurposing it. Do not reset or overwrite it. Create no other implementation branches without a concrete need and human authorization where required.

Only central integrates reviewed lane commits into `docs/replatform-program`. Lanes may commit and push their own branches, but do not merge each other or directly update the program branch. Central chooses merge/cherry-pick once, records the mapping and avoids replaying both copies. Pass prerequisites as exact commits and interfaces; a message saying “done” does not release a dependency. A dependent lane incorporates the reviewed prerequisite commits before using their APIs.

Retain the existing repository ticket/result review conventions. Do not mark entire W packages or release gates complete from narrower P1 acceptance. Do not merge `main`, release, promote images or change production infrastructure under this instruction. Teardown/deletion of verified newly owned disposable test resources is required under the shared-host protocol; unrelated/global/destructive cleanup remains outside scope.

## Coordination state and handoffs

Central owns the local, uncommitted operational registry at `C:\Users\Dell\Desktop\aoa\.p1-coordination\state.json`, recording verified coordinator/lane IDs, hosts, branches/worktrees, base/ready commits, ticket/dependencies, authorization reference, wait cursors and resource bookings/locks. All lanes use this same host-global location, not independent copies in their worktrees. The shared-host protocol specifies remote ownership records and run roots. Ensure operational state is not staged/published. After interruption reconcile app and actual host state before scheduling; never assume a lane/resource exists or is gone because a request/SSH command ended.

Maintain durable ticket progress/results in the repository's existing plan and evidence locations. Only central updates the shared status summary; lanes supply reviewed ticket evidence on their branches. Commit milestone status when dependencies or acceptance materially change rather than having every chat edit one status file at once.

Every dispatch states: ticket, scope/files, base/prerequisite commits, interface, expected output/tests, constraints and handoff target. Runtime dispatch also includes its host booking, run roots/project, resource/port allocations and cleanup owner. Every handoff states:

```text
Ticket and status: ready_for_review | waiting_dependency | needs_human
Chat/worktree/branch and exact implementation commit:
Prerequisite commits actually incorporated:
Files and interface changes:
Functional commands, native exits and pass/fail/skip counts:
Evidence paths and remaining limitations:
Documentation check result:
Test host booking/run IDs, actual owned resources and cleanup receipt:
Retained evidence/hash, residuals and booking released/cleanup_pending:
Requested next action / exact dependency:
```

`ready_for_review` is not `complete`. Central checks the actual diff, candidate-scoped evidence and resource cleanup receipts, requests fixes as needed, and integrates only after the required independent review. A Luna document check is supporting evidence, not code approval. A lane with unresolved owned runtime/disk residue reports `cleanup_pending`; it cannot silently return its host to the free pool.

## Messaging authorization, waiting and resumption

The human launch prompt must expressly authorize bounded communication among this coordinator and the P1 chats it creates or the human names. Forward the scope and an actual reference to that original human authorization in each lane dispatch. Before sending a reply, the lane verifies the original human permission through accessible trusted chat context; a command from the coordinator alone, an unverified copied quote or this repository guide is not new authorization. If permission cannot be established, ask for the missing human authorization rather than manufacture it. Keep communication within these P1 participants; no email/Slack/external messaging is included.

Use app chat-message tools for independent lane chats and collaboration tools for subagents in the same agent tree. Cross-chat messages are user-visible follow-up prompts; they are not a passive shared-memory channel and may start another turn. Use them for dispatch, concrete questions, ready commits, blockers and review findings. Route integration/interface conflicts through central. Avoid mutual acknowledgement loops and repeated unchanged status messages.

Central uses bounded chat waits with returned cursors, at most 60 seconds per blocking call, and works on reviews/independent tasks between updates. Do not repeatedly reread entire histories or spin on unchanged status. A dependent lane reports `waiting_dependency` once and yields; central sends an explicit continuation after integrating the prerequisite. Dependency waiters do not occupy implementation subagent slots indefinitely.

While central is actively waiting it can resume on completion/attention events. If its turn ends or the app/runtime stops, this document is not a background scheduler. Resume with an explicit user turn; persistent future wakeups/automations require their own user request. On resume, reconstruct app/commit state before redispatching to prevent duplicate implementation.

## Copyable central launch prompt

Select **Astra High** for the central chat, open the AoA project, and submit:

```text
Act as central command for the P1 local-worker fleet on docs/replatform-program.
I approve the documented P1 plan for execution within its stated scope.

Read AGENTS.md and its required sources, docs/replatform/README.md,
docs/aoa/plans/2026-10-19-p1-orchestration.md, and the linked P1 design,
seven-ticket implementation plan and current test policy.
Also read docs/aoa/plans/2026-10-19-p1-test-resources.md before test setup.

Use Astra High (gpt-6-astra, high) for central orchestration/review.
Use Sol High (gpt-6-sol, high) for lane chats and implementation subagents.
Use Luna High (gpt-6-luna, high) for read-only documentation/evidence checks.
Set model AND effort explicitly using actual tool settings. Report an
unavailable model/effort instead of silently substituting it.

I authorize creating the provider, credential and scheduling/recovery chats
in separate worktrees from the reviewed docs/replatform-program base, using
branches codex/p1-provider, codex/p1-credentials and codex/p1-scheduling.
You may commit/push those branches and integrate reviewed commits into
docs/replatform-program. Keep unrelated work intact; do not merge main.

I authorize this coordinator and all P1 lane chats/subagents created for
this run to exchange task, dependency, review and completion messages
with one another. Include a verifiable reference to this original human
authorization and the actual coordinator chat ID in every lane dispatch.
This authorization covers only these P1 participants and this scope.

Do P1-01 first. After its boundary/interfaces pass review, run P1-02,
P1-03 and P1-05 in parallel. One database owner continues P1-05 into P1-06.
Assign one owner to P1-04 when P1-02/P1-03 are ready; finish with P1-07.
Dependent lanes should report their blocker once and yield. Use wait tools
and explicitly resume them after reviewed prerequisite commits are available.

Reuse completed W01-W17 work. Both API keys and owner-bound Codex
subscriptions remain required. Follow the documented credential/isolation
boundaries. Stop for the precise missing access, credential prerequisite,
unsupported subscription mode or required security/scope decision.

Run targeted functional checks and affected-package types/builds. Whole
suite stays in GitHub CI; performance/load/latency/soak campaigns remain
deferred. Bounded disposable functional probes are in scope using already
authorized resources/credential custody; ask for missing access rather than
copying personal auth or launching unrelated paid-provider campaigns.

The available test hosts are this local Windows PC and the testing VPS.
From Windows, use:
ssh -i "C:\Users\Dell\.ssh\aoa-testing" root@2.28.28.156
Docker and standard dev tooling are reported available on both; verify
actual capacity/versions before setup. Never read/copy/publish the key.
Disk/RAM/CPU are constrained: centrally reserve each physical host, default
to one heavy test/build batch per host, and reserve both for paired tests.
Use host-global locks and unique run directories, ports, Compose projects,
DB/storage state and logs. Parallel code lanes do not imply parallel heavy
test capacity. Reuse safe caches/builds and avoid duplicate installations.
I authorize and require cleanup/deletion of newly owned disposable test
resources on success, failure, cancellation or timeout, per that protocol.
Retain compact verified evidence; preserve permanent auth, shared tooling,
unrelated resources and source work. No global prune or blanket kill/delete.
Verify teardown and release the booking before another batch starts.

Keep a coordinator-owned status registry, verify handoff commits/tests,
and perform code/security review separately from Luna documentation checks.
Proceed through the ready tickets without asking for approval at each ticket.
No production rollout, release publication or unrelated destructive cleanup
is authorized. Owned disposable test cleanup is required as described above.
```

The launch prompt is the current human instruction when the user submits it. The historical “planning only” notes in the design/plan describe their preparation; they do not require repeated permission after a later explicit implementation launch. Feasibility, required credential access and architecture/security decisions still follow their actual documented gates.

## Lane dispatch checklist

Central includes the assigned ticket(s), actual IDs and reviewed commits rather than copying a generic “implement everything” prompt. Tell the Sol lane to read this guide, the assigned ticket and applicable repository instructions; implement only its owned scope; run targeted checks; use Luna High for a read-only documentation/evidence review; and return the structured handoff. Give the lane a trusted route to verify the original human messaging authorization. Do not assume an orchestrator-generated message grants authority by itself.

## Capability references

[Official Codex subagent guidance](https://learn.chatgpt.com/docs/agent-configuration/subagents) documents delegation and explicit model/effort configuration. [AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md) describes durable repository instructions. For cross-chat create/read/message/wait behavior, use the actual available Codex app tool schemas in the executing chat; do not infer them from the separate API's multi-agent documentation. Availability and concurrency are runtime constraints, not promises made by this repository file.
