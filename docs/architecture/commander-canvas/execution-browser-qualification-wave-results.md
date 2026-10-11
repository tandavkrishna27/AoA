# B12 execution and browser qualification — current-source gate review

- **Current source re-review:** 2026-10-11
- **Source base:** `13b4e806f31a67c3c172f2216272570203132f8f` (`origin/docs/replatform-program`)
- **Review worktree:** `codex/universe-replatform-lineage-candidate-20261011`
- **Prior review:** `codex/universe-interface` at `bfdca45dc9271180793c5e2731ceae6c28fe02ec` (2026-09-20)
- **Status:** Partially unblocked in source, but B12 remains blocked at accepted output-slot binding and external browser qualification; no B12 runtime activation performed.

## Result

B11 is complete. Re-reviewing the newer replatform source found that Commander now has distributed invocation, accepted-result reading, original-conversation reply persistence and recovery. These are meaningful producer additions since the prior review. They do not yet establish the exact accepted output-slot identity, supersession/cancellation validity and transaction/CAS authority required by the worker-publication contract. Browser Use pipe attachment and independent cloud/local qualification are also still absent. B12 remains blocked as a complete wave; keep its source findings separate from runtime qualification.

## E2.2/2.a — canonical output binding

The newer source now exposes `createCommanderDistributedPort`, `createCommanderDistributedResultReader`, `persistCommanderDistributedReply` and `createCommanderResultRecovery`. The path validates a distributed job/attempt against the Commander run, reads the accepted terminal/artifact record, and persists the reply to its originating conversation with recovery. That closes part of the earlier “no result-delivery producer” gap.

The specific producer required by E2.2/2.a is still missing:

- No current source writes the worker-publication action tuple or stable output-slot UUID from the authoritative Commander claim/CAS. The recovery reader's job/attempt and result artifact identity are sufficient to recover a conversation reply; they do not decide which generated artifact slot is accepted for Universe publication.
- `server/src/services/job-output-bridge.ts` projects caller-authorized accepted output events into task outputs. It does not elect the accepted Commander output slot and cannot substitute for that owner.
- The `commander_turn` disposition in `server/src/services/job-admission-bridge.ts` remains documented as inert for that parity bridge. The separate distributed Commander path does not make this bridge or the worker-publication acceptance tuple authoritative by implication.

Creating `universe_output_bindings` without that owner would create a second, ungrounded acceptance authority. This increment remains blocked until replatform exposes the exact admitted-job/attempt/slot, cancellation and claim-token transaction seam. When it exists, the planned replay, competing-attempt, stale-claim and cancel races must run against that real export.

## E6.0/1.b — contained Browser Use attachment

No Browser Use runtime/package is present in the re-reviewed manifests or lockfile, and the existing browser runtime has no reviewed interactive attachment API. The current pipe-based Playwright runner remains contained; `packages/browser-runtime/src/launch-guard.ts` must continue rejecting CDP ports, remote-debugging switches and exposed endpoints.

Before implementation, qualification must pin the Browser Use version and prove it can attach to the worker-owned pipe/browser object without opening CDP or a remote WebSocket. If its supported API requires either endpoint, the adapter is blocked rather than weakening the guard.

## E6.0/2 and E6.0/3 — cloud and local qualification

These are evidence gates, not interchangeable unit-test work:

- Cloud needs the accepted cloud image/tier, authenticated media/input transport, metadata isolation, controller fencing and native-dialog/tab capability evidence.
- Local needs the actual desktop worker and a second authorized device, browser-only capture, disconnect/input denial and same-session reconnect evidence.

Neither environment is configured or authorized in this checkout. A local pass cannot certify cloud and a cloud pass cannot certify local.

## Required next inputs

1. Replatform lands and identifies the authoritative Commander distributed result-acceptance export and its cancellation/claim transaction.
2. The Browser Use package/version and pipe-attachment API are selected and reviewed without changing the launch guard.
3. Cloud and local qualification environments and accountable owners are named and authorized.
4. Re-run this gate review at the adopted replatform SHA, then implement E2.2/2.a and E6.0/1.b and execute E6.0/2 and /3 independently.

B13 generated-worker publication remains dependent on E2.2/2.a and must not be started through a fabricated binding. Independent work may continue only where the execution sequence has no dependency on this producer.
