# M1a Protected Command Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver an authenticated local campaign command gateway, durable operation records and migrated harness command routing without activating a campaign.

**Architecture:** A Python standard-library Unix-socket service authenticates Linux peers using SO_PEERCRED and owns the campaign Docker endpoint. Protected profiles and a separate Node authority verifier feed typed dispatch; candidate requests never supply Docker argv or authority roots. Existing ESM consumers use a fixed Python socket client, not Docker directly in protected mode.

**Tech Stack:** Python3 standard library, Node ESM/crypto, existing node:test suites, Docker CLI invoked without shell. No new package dependency or live host setup.

**Spec:** `docs/replatform/milestones/M1a/protected-command-gateway-spec-2026-09-27.md`, approved by user's subsequent instruction to proceed. Written-plan review remains required before implementation.

## Global Constraints

- Linux-only production transport; Windows refuses production gateway startup.
- Requests at most65536 bytes, closed version1 JSON, strict UTF-8 and duplicate-key refusal.
- Candidate never receives either Docker socket, sudo, controller writes or authority/archive credentials.
- No implicit build/pull/tag fallback; no public raw output; no production activation from unit-test success.
- Preserve existing TEST/DEV_ONLY helpers and immutable history/candidate refs.
- Signing, accounts/daemon provisioning, provider creation, evidence upload and campaigns are outside this source plan.
- Read repository instructions and existing helpers before edits; use fresh task implementer and reviewer, then final whole-branch review.

## Review Focus

1. Client disconnect after side effects: preserve unknown outcome and never redispatch.
2. Privileged Docker environment inherited by subprocesses: use fixed endpoint/environment, never candidate DOCKER_HOST/context.
3. Partial replica rollout: freeze further execution and retain each replacement binding.
4. Socket/journal path replacement: refuse symlink/hardlink/unsafe ownership and protect ancestors before IO.
5. Secret-bearing inspect/log output: private bounded transport, no stdout fallback or arbitrary environment projection.

## Interface And File Map

Python package `scripts/m1_gateway/`: `protocol.py`, `journal.py`, `dispatch.py`, `server.py`, `client.py` and `__init__.py`. Tests use unittest under `scripts/m1_gateway/tests/`; Node integration tests run Python via fixed subprocess argv. Node `scripts/lib/m1a-gateway-authority.mjs` owns authenticated policy parsing; `scripts/lib/m1a-gateway-client.mjs` owns existing ESM caller adaptation.

Request common keys: `version:1`, `session:string`, `operationId:string`, `operation:string`, `services:string[]`, `arguments:object`. Identifiers match `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`. Services are unique, at most32, selected from protected profile. No optional unknown keys.

Operation arguments are closed: ordinary lifecycle `{}`; kill `{signal:'SIGKILL'|'SIGTERM'}`; exec/run `{payloadId,stdinBase64}`; inspect `{projection:'binding'|'topology'|'rollout'}`; logs `{limitBytes}` with1..1048576; apply-rollout `{enabled:string[],control:string}` UUIDs, unique and disjoint. Run/exec accepts only controller-profile payload IDs; decoded stdin at most32768 bytes. Payload definitions have fixed executable/argv and container-only execution, with reviewed stdin handling. Unknown IDs refuse. No host-shell payload evaluation.

Response common keys: `version`, `operationId`, `state`, `exitCode`, `result`. State is accepted, dispatching, observed-success, observed-failure or outcome-unknown; exitCode is integer0..255 or null. Result is bounded profile-approved data. Protocol/security refusal uses fixed error code and no reflected raw input.

## Task1: Closed Protocol And Authenticated Transport

**Files:** Create package protocol/server/client modules and `tests/test_protocol.py`, `tests/test_transport.py`.

**Interfaces:** `decode_request(raw:bytes)->dict`; `serve_connection(conn,peer_uid:int,session_lookup,handler)->None`; `request(socket_path:str,request:dict)->dict`. Session lookup is protected server configuration indexed by authenticated UID; session ID is an additional match, not authorization.

- [ ] Write tests `test_duplicate_keys_refused`, `test_unknown_argument_refused`, `test_65537_bytes_refused`, `test_invalid_utf8_refused`, `test_peer_cannot_select_other_session` and Linux real-socket peer test. Assert handler calls remain0 for each refusal.
- [ ] Run `python -m unittest discover -s scripts/m1_gateway/tests -p test_protocol.py`; confirm RED from missing implementation, not dependency failure.
- [ ] Implement strict json.loads object_pairs_hook duplicate rejection, finite numbers only, per-operation closed validation and a single length-prefixed request/response per connection. Authenticate SO_PEERCRED before reading request payload; bounded read/deadline, no EOF-dependent framing. Client/server Unix socket paths are absolute trusted startup config.
- [ ] Run protocol and transport tests; expect PASS, Linux peer test explicitly skipped only on unsupported local platform. Production factory refuses unsupported peer authentication; no production test-UID override.
- [ ] Commit task files; fresh reviewer checks parsing/authentication and path lifecycle before Task2.

## Task2: Durable Journal And Recovery

**Files:** Create journal.py and tests/test_journal.py.

**Interfaces:** `Journal(root:str)`; `accept(session,id,request_hash)->dict`; `transition(session,id,state,result)->dict`; `lookup(session,id)->dict`; `recover()->list[dict]`. Use SHA256 of canonical validated request bytes; raw payloads are not journaled.

- [ ] Add RED tests for changed-body ID collision, identical completed replay, crash at dispatching, fsync failure, unsafe ancestor/symlink/hardlink and disconnect preserving record. Assert replay dispatch count0 and recovered dispatching state outcome-unknown.
- [ ] Run `python -m unittest discover -s scripts/m1_gateway/tests -p test_journal.py`; confirm RED.
- [ ] Implement protected0700 root/0600 records, owner/ancestor and link checks, exclusive session lock using flock, atomic temp write/fsync/replace/directory-fsync. Persist before effects; startup turns dispatching records into durable outcome-unknown. Never treat malformed or lost records as a fresh operation. Bound each record64KiB, refuse full/unwritable storage.
- [ ] Run tests with real temporary filesystem and injected write failure; require PASS. Unsupported OS refuses production journal, not weaker durability.
- [ ] Commit and independently review journal transitions/privacy before dispatch implementation.

## Task3: Production Authority Verification And Fixed Dispatch

**Files:** Create m1a-gateway-authority.mjs with Node tests; dispatch.py with tests/test_dispatch.py.

**Interfaces:** Node `verifyGatewayAuthority({signedPolicyBytes,signatureBytes,trustedPublicKeyPem,expected,now,revocation})->authenticatedPolicy` verifies Ed25519 over exact bytes before decoding. Public key/configuration come only from protected controller input. Python `Dispatcher(profile,authority_check,inspector,runner,journal).execute(peer,request)->dict` uses fixed dependencies, not caller closures in the production factory.

- [ ] RED tests reject candidate-provided roots, TEST bindings, wrong controller/candidate/session/profile, expired authority after an operation wait and unavailable revocation. Never relax existing helper refusals.
- [ ] Implement a separately versioned closed production envelope binding candidate/controller/session/profile hash, notBefore/expiresAt and authority fingerprint; retain signature/policy byte hashes. Complete image/provider inventories are separately schema-validated against protected expected profile, never self-derived from supplied policy. Keyed/provider capabilities remain refused until supported provider contract is approved; no invented build selector.
- [ ] Add dispatch RED tests for candidate DOCKER_HOST inheritance, daemon substitution, missing dependency, tampered image/container, keyless adapter-manager closure, unknown payload ID, execution on expired authority and bounded cleanup on expired execution authority.
- [ ] Implement fixed Docker endpoint and trusted Compose/profile construction with explicit no-build/no-pull and allowed operation mapping. Inspect actual identity kind and all replicas before each effect; serialize check/dispatch under session lock. Treat exception/timeout after effect entry as unknown. Only gateway-owned recorded resources may be cleaned. Profile rejects mounts/devices/privileges/endpoints outside reviewed allowlist; runtime build/restart-policy routes refuse.
- [ ] Run `node --test scripts/lib/__tests__/m1a-gateway-authority.test.mjs` and Python dispatch tests; PASS with fixture authorities only, no live Docker/signing/provider access.
- [ ] Commit and fresh review complete authority, environment and cleanup boundary.

## Task4: Gateway Server Integration And Private Responses

**Files:** Complete server.py/client.py; add tests/test_server.py and scripts/lib/m1a-gateway-client.mjs plus Node test.

**Interfaces:** `start_gateway(config_path:str)->None` accepts one absolute protected startup configuration, performs capability/ownership checks, loads session UID mapping and fixed endpoint, then binds socket0600. Node `gatewayOperation(request,{socketPath,timeoutMs})->{state,exitCode,result}` calls only the fixed Python client path and returns bounded output.

- [ ] RED integration tests run a real Unix socket with fixture dispatcher/journal: unauthorized peer, partial frame, response oversize, disconnect after effect, restart reconciliation, unsafe socket parent and journal storage failure. Unknown outcomes must block later execution but permit scoped cleanup/reconciliation.
- [ ] Implement lifecycle without shell, caller-selected client interpreter or env-selected controller path. Python client gets no secrets and never falls back to Docker. Private stdout is captured by the Node caller, not forwarded to public console; stderr contains fixed refusal codes only.
- [ ] Verify real Linux transport and durable-journal integration; Windows tests may exercise closed parser but must not claim deployment proof. `python -m unittest discover -s scripts/m1_gateway/tests` and client Node tests PASS.
- [ ] Commit; fresh review sockets/peer ownership, subprocess environment, output bounds and recovery.

## Task5: Consumer Migration, Probe And Rollout

**Files:** Modify scripts/m1-shipped-boot/journey.mjs and tests/d1/lib/e6f-harness.mjs; add scripts/lib/__tests__/m1a-gateway-migration.test.mjs and protected operation inventory under scripts/m1_gateway/operation-inventory.json.

**Interfaces:** Consumers call gatewayOperation from Task4 with typed operations only. Preserve exported harness signatures. Protected mode is explicit; gateway error never chooses legacy direct Docker. Existing unprotected historical development mode remains clearly separate, not a compliant campaign entry point.

- [ ] Inventory every Docker subprocess in both files and their imported execution helpers, including inspect, topology, logs, kill/start/restart, one-shots and rollout. Write failing migration tests that exercise each recorded callsite with fake gateway and assert no protected-mode Docker spawn.
- [ ] Migrate compose dispatch and direct inspect paths to typed operations; project/Compose/env choices move to protected session config. Do not expose a generic argv-to-gateway adapter. Preserve existing test APIs and capture semantics.
- [ ] Add separately admitted keyless probe profile with fixed Node HEAD payload, required network/CA equivalence checks and no provider credentials. Refuse unsupported profile rather than run adapter-manager in keyless mode. Keyed disposable probes record distinct container identities and removal outcomes.
- [ ] Implement controller-owned apply-rollout: tenant IDs must match session setup results; use existing buildRolloutPolicy/evaluateTenantRollout semantics, exclude control tenant, change only rollout field, persist new config hash and sequential replica bindings. Add tests for cross-session tenant, partial replica failure, stale authority on second replica and unknown outcome.
- [ ] Run migration tests and existing journey/harness focused tests offline. Preserve F3/DEP015/E6F030 assertions. No campaign stack starts for source tests.
- [ ] Commit and fresh reviewer checks operation inventory against source and every changed consumer path.

## Task6: Ordinary CI, Documentation And Whole-Branch Verification

**Files:** Modify ordinary PR offline test step only if necessary, scripts/test-inventory.json via existing generator; create gateway operations guide under docs/replatform/milestones/M1a.

- [ ] Add an ordinary credential-free Python unittest step or extend existing ordinary offline step, then verify register citations against actual line changes. No new workflow_dispatch campaign/upload job, permissions or secrets. Run inventory generators instead of hand-editing counts.
- [ ] Document controller startup contract, private directories, effective account/socket requirements, unknown-outcome reconciliation, no public raw logs and live activation checklist. Clearly state deployment boundary tests still require separately authorized real-host proof.
- [ ] Run all new Node and Python suites on Linux CI, including real socket/durability tests; no inferred pass from Windows skips.
- [ ] Run `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`; report every failure/cancellation/skip accurately. Compare immutable QA/history blobs to baseline and verify historical candidate ref unchanged.
- [ ] Fresh whole-branch review covers source authority, alternate endpoint bypass, migration coverage and failure recovery. Publish only under user's source-publication authority; merge only after exact-head CI/comments and integration authorization are clear.

## Self-Review And Handoff

Task1 owns closed protocol/peer authentication; Task2 durable outcomes; Task3 authority and dispatch; Task4 executable local server/client; Task5 actual consumer migration/probe/rollout; Task6 verification and deployment requirements. The five review-focus conditions have tests in Tasks2-5. Activation, provider admission and final evidence/verifier custody remain explicitly outside this subproject, not asserted solved.

This plan uses fresh implementers/reviewers sequentially because shared protocol/journal interfaces are dependencies; parallel work is limited to disjoint verification/research, not competing edits. User written-plan review must precede source execution. No signing key, live upload, host modification or campaign starts during this plan's offline implementation.
