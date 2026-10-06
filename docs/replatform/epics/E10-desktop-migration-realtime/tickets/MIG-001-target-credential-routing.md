# MIG-001 — target and credential routing

Implementation checkpoint, 2026-10-07. M2 scope follows Decisions 117 and 121.
The user authorized code and testing, with Anthropic credentials skipped and
rollout flags off. This ticket adds no certification or activation requirement.

## Required behavior

The control plane derives placement from the durable job, its actual requester,
and the authorized credential metadata. A selected target cannot establish the
identity of the credential owner. Explicit pins remain subject to credential,
tenant, membership, capability and current target-generation checks.

Company credentials may use an eligible isolated worker target. Personal
subscription credentials remain bound to their actual owner and eligible owner
target. Unavailable or unsupported routes fail closed; shared cloud execution
never falls back to a control-plane host process.

## Implementation sequence

1. Require independent owner authority for personal placement. Test matching,
   missing and wrong owners through the pure normalizer and real placement
   transaction. Keep the existing four-field canary binding and replay digest
   unchanged for company-key task and crew runs.
2. Resolve credential metadata from the actual source and requester. Reuse the
   existing assignment precedence, sharing gates and governed subscription
   binding. Do not materialize credential values to choose a target. Test foreign
   company/organization, revoked connection, suspended owner and ambiguous binding.
3. Compose the resolver into the real placement path for the new sinks. Retain the
   established task/crew canary route. Test exact selected target and replay,
   including an owner change between admission and placement.
4. Generalize secret minting for authorized Commander and agentless one-shot
   sources using server-derived provider identity. Preserve the credential class
   and exact secret reference; no fake agent, company-key substitution, personal
   auth-home upload or provider key in job input.
5. Consume the resulting placement and credential authority in Commander and
   extraction. Their completion, cancellation, cost, audit, approval and result
   paths belong to MIG-005 and MIG-007. Prove legacy execution is suppressed only
   after an actual successful ownership transfer.

## Checks

- RED/GREEN owner mismatch tests; real PostgreSQL placement with an authorized
  matching owner as the positive control.
- Existing canary binding, target normalization and placement replay tests.
- Source-specific credential and worker execution tests, including revocation.
- Repository typecheck, test suite and build, followed by normal PR CI.

## Current progress

Independent owner comparison and trusted Commander metadata routing are implemented.
The production placement composition preserves the exact four-field task/crew
canary binding. Commander routing loads the actual company/organization, frozen
job, turn, user and conversation, then applies existing assignment precedence and
sharing gates with current membership checks. Metadata selection never resolves
secret values or auth homes. Unsupported sources fail closed.

72 focused tests passed, including 25 real PostgreSQL placement/schema tests:
correct-owner placement/replay, wrong/missing owner, foreign company/organization,
revoked connection, suspended user and mismatched conversation. Repository
typecheck/build passed; the full local suite passed 23,576 tests before rebasing
onto merged crew Discussion recovery. Normal CI validates the rebased candidate.

Source-specific company-key minting and Commander/extraction asynchronous results
are implemented on the combined program candidate. Armed Commander placement
refusal surfaces an error rather than selecting a legacy executor. Warm retained
ownership also suppresses legacy acquisition under rollback or a missing port.
Personal routes retain independent owner checks and refuse unsupported execution;
full device-local broker execution belongs to desktop work and remains unbuilt.
Personal metadata routing does not authorize copying a CLI auth home into a
cloud sandbox. Combined typecheck, full-suite and build checks passed. All code
PRs passed required CI and merged into the program branch. Rollout remains off.
