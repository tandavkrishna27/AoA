# M1a Protected Render Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a protected, render-only Compose observation with a durable, secret-safe verdict, without admitting bootstrap or changing existing execution sessions.

**Architecture:** A separately signed render-only session uses the existing authenticated Unix transport, custody checks and journal storage, but never constructs the existing-container dispatcher. A fixed private Compose invocation feeds a pinned Node verifier that evaluates the same complete bytes through the existing scoped DEP-015 and unscoped dispatch-default-off checks. The gateway returns only closed metadata; a later, separately authorized bootstrap must compare a fresh render against the protected handoff before its first effect.

**Tech Stack:** Python standard library, Node ESM, existing Compose invariant module and node:test/unittest suites. No new dependency, live Docker, provider call or campaign in source tests.

**Spec:** `docs/replatform/milestones/M1a/gateway-render-projection-spec-2026-09-28.md` (approved for planning on 2026-09-28). The user approved this plan on 2026-09-28 and explicitly authorized offline, fail-closed source work with test fixtures before the owner packet is complete. Production activation remains gated on the completed, independently reviewed packet.

## Global Constraints

- The current `m1a-gateway-render-profile-offline-v1` / render policy helper is explicitly `OFFLINE_TEST_ONLY`. It binds service names and dependency edges but cannot represent the complete production image, endpoint, dispatch, sensitive-field or substitution-input expectations. Production startup must refuse it. Task 1 is not complete until a separately reviewed production schema and signed input set cover those fields, plus mode-isolated startup and runtime refusal tests.
- Source-only work. Ephemeral test signatures are allowed; no trusted production signing, host installation, credential provisioning, AWS upload, provider call, campaign, merge or milestone promotion follows from this plan.
- Preserve the version-one six-key request envelope. Add only `inspect` with exactly `{ "projection": "render" }` and the complete sorted protected render-profile service set.
- Keep current execution-session startup inspection and logs-only behavior unchanged; render-only accepts no lifecycle, logs, exec/run, probe, rollout or cleanup operation.
- No caller-controlled Compose path, project, env, endpoint, validator root, service subset or argv. No inherited candidate/job environment or `DOCKER_HOST`.
- No raw render, resolved env, stderr, validator prose or private path in response, journal, candidate workspace or ordinary CI output. An uncertain post-entry outcome is never silently retried.
- Existing journal-v1 records and frozen M1a evidence remain byte-identical. Do not claim 180-day raw retention from a digest.
- The existing DEP-015 checker, unscoped `DISPATCH-DEFAULT` positive control, F3 and E6F030 semantics do not change.

## Decisions Before Source Execution

TK, as accountable Integration/Security owner, must approve a written protected-input/profile packet: exact Compose file/project and substitution-input identities (including private value hashes), complete expected service/dependency/flag/endpoint set, private render byte/time ceilings, closed stable violation-code set, and whether raw bytes require separately authorized evidence custody. These are not inferred from fixtures, the historical candidate or this plan. An independent reviewer must confirm the packet agrees with the execution profile where services overlap. Offline test-fixture implementation is authorized first; production startup must refuse unless the independently reviewed packet is installed as a signed protected profile. No placeholder profile is promoted to production.

## Review Focus

1. A changed substitution value with unchanged Compose files must refuse bootstrap; Task 5 tests exact pre-effect re-render equality.
2. An unrelated unscoped violation must not count as the dispatch-default positive control; Task 3 tests the precise `DISPATCH-DEFAULT` predicate.
3. A render-only socket must not become an execution route after restart or replay; Tasks 1 and 4 test mode separation and journal namespaces.
4. A verifier error or truncated output after Compose starts must be uncertain, never a clean refusal or promoted prior digest; Tasks 2 and 4 fault-inject this.
5. A missing, extra or reordered caller service set must refuse before Compose; Task 1 tests complete sorted membership and zero effects.

## File Map

- `scripts/m1_gateway/protocol.py`: closed render request and response validation.
- `scripts/m1_gateway/composition.py`: protected render-only startup variant, fixed private Compose invocation, pinned verifier bridge and custody.
- `scripts/m1_gateway/render.py` (new): render-profile validation and closed projection/result assembly; keep the existing composition file focused on startup and IO.
- `scripts/lib/m1a-gateway-render-verifier.mjs` (new): exact-byte scoped/unscoped invariant evaluation and stable-code mapping.
- `scripts/m1_gateway/journal.py`: versioned render-only terminal metadata without rewriting v1 records.
- `scripts/m1_gateway/server.py` and `scripts/lib/m1a-gateway-client.mjs`: preserve authenticated transport and typed closed result, no raw fallback.
- `scripts/m1_gateway/tests/test_render.py`, existing protocol/journal/server tests and `scripts/lib/__tests__/m1a-gateway-render-verifier.test.mjs`: offline positive, negative, replay and privacy controls.
- `scripts/m1-shipped-boot/journey.mjs`: later typed-verdict consumption for preboot/postrollout checks only after parity proof; remaining raw Docker callsites stay explicitly incomplete under the parent gateway plan.

### Task 1: Closed Render Mode And Profile

**Interfaces:** `decode_request(raw) -> dict` admits `inspect/render`; `RenderSession(anchor, manifest, session, files, custody, journal)` authenticates a separately signed profile and exposes `execute(uid, request)`. Existing `SessionRuntime` remains execution-only. Define a versioned manifest `mode` discriminator, distinct operation namespace and protected render-profile fields in this task; use no test-only default in the production factory.

- [ ] Write failing protocol/startup tests: complete sorted services accepted; missing/extra/duplicate/unsorted set, arbitrary arguments, unsigned profile, wrong peer/candidate/session/controller/root, stale revocation, and render-only lifecycle/logs/exec/rollout all refuse with zero Compose calls. Fixture includes uncreated adapter-manager while keyless execution still refuses it.
- [ ] Run the targeted Python suites and record expected RED from missing render support.
- [ ] Implement the closed request, mode/profile parsing and render-only startup. Reuse protected file pins, code checks, authority bridge and custody; do not construct `Dispatcher` or call existing-container `inspect` in render-only mode. Keep execution startup inspection mandatory.
- [ ] Run the targeted suites GREEN and the existing gateway baseline; commit only the scoped files. Fresh reviewer checks mode isolation, complete membership and no widening of the old execution profile.

### Task 2: Fixed Private Compose Render

**Interfaces:** `render_compose(runtime, approved_inputs) -> (bytes, sha256)` in `render.py`. `approved_inputs` is controller-owned, pinned and bound to the render session; no candidate path or environment is accepted. Use the reviewed `docker compose -p aoa-m1-boot --env-file <private> -f docker-compose.staging.yml -f docker/m1-boot/docker-compose.m1-boot.yml config --format json` shape, with exact paths and limits supplied by the approved packet, not assumed as live values.

- [ ] Write RED tests for fixed argv/cwd/environment, absence of inherited `DOCKER_HOST`, pin substitution, nonzero exit, timeout, stdout/stderr overflow, malformed UTF-8/JSON, duplicate keys, non-finite values and changed input pin. Assert no raw bytes reach output, journal or logs.
- [ ] Implement bounded capture with the existing private subprocess/custody path and SHA-256 over the complete raw stdout before parsing. Validate the complete service/dependency and sensitive-field shape against the protected profile, never against render-self expectations.
- [ ] Run targeted GREEN tests, then commit. Fresh reviewer checks no build/pull/up side effect and no secret-bearing error path.

### Task 3: Pinned Verifier And Closed Verdict

**Interfaces:** `evaluate_render(raw_bytes, expected_profile) -> RenderVerdict` in a fixed Node bridge, returning only schema version, digest, complete service names, scoped pass, dispatch-default-specific unscoped red, bounded counts and approved stable codes. Pin the bridge and its import closure as protected code; do not accept a verifier path from a request.

- [ ] Write RED Node tests using one merged-render fixture: scoped DEP-015 pass and `DISPATCH-DEFAULT` unscoped red on the same bytes/digest. Add negatives for wrong dispatch flag/provider placement, changed overlay path, unrelated-only unscoped violations, validator failure, changed bytes between checks and a secret canary absent from the result.
- [ ] Implement calls to `evaluateShippedBootOverlayInvariants(rendered, null, {overlayPath: SHIPPED_BOOT_OVERLAY_PATH, rendered: true})` and `evaluateStagingManifestInvariants(rendered)`. Pin a reviewed code mapping; never return arbitrary violation text. Refuse admission unless scoped pass and positive-control red.
- [ ] Run targeted GREEN tests and existing manifest tests; commit. Fresh reviewer compares results to `scripts/check-staging-manifest.mjs` without weakening its semantics.

### Task 4: Durable Render Terminal And Replay

**Interfaces:** Add a separate versioned render-only journal terminal record carrying render digest, profile hash, scoped/positive-control verdicts, stable codes and operation/session binding. Existing v1 terminal shape remains unchanged. A replay returns committed metadata with `renderAvailable: false`, never the bytes or a new check.

- [ ] Write RED tests for payload write/file-sync and marker creation/directory-sync faults, lost reply, verifier failure after Compose entry, two distinct render operations, cross-mode replay and old v1 record replay. A durably dispatching operation with an absent marker recovers unknown; a present invalid marker refuses; a valid surviving marker is re-synced and replays exact metadata with no redispatch or raw data persisted. Do not infer reply receipt from a sync outcome.
- [ ] Implement the new record validator/transition and render route under the existing session lock using the approved validated-marker protocol in `gateway-render-durability-decision-2026-09-28.md`. Mark uncertain outcomes after command entry; do not convert a prior digest into a current verdict.
- [ ] Run targeted GREEN tests and full gateway Python baseline, including real Linux fsync tests in ordinary CI; commit. Fresh reviewer checks immutable old records, unknown-outcome recovery and privacy.

### Task 5: Handoff Contracts And Consumer Parity

**Interfaces:** A controller-private handoff binds candidate/session, protected substitution-input identity and preboot render digest. The future bootstrap admission function `verify_preboot_render_handoff(handoff, fresh_render)` must require an exact digest and input-identity match immediately before its first effect. This task may add a source-only refusal/verification helper and tests; it does not admit bootstrap itself.

- [ ] Write RED tests: same protected inputs reproduce digest; changing only an env substitution with unchanged files, missing handoff, stale authority or changed bytes refuses before effect. Postrollout uses a new operation/digest and cannot replay the preboot verdict.
- [ ] Add typed preboot/postrollout verdict consumption in `journey.mjs` only behind explicit protected mode, preserving historical unprotected development mode separately. Parity tests compare the existing raw-render checks with the new typed verdict and retain F3/DEP-015/E6F030 checks. A typed verdict is not a live-runtime, presign or retention claim.
- [ ] Specify separate follow-on admissions, without implementing them here: complete live replica/config comparison; keyless presign target from protected render and reviewed network/CA; bootstrap pre-effect re-render, image admission/create/up; cleanup reconciliation. Keep all these gates red/unsupported until independently reviewed source and evidence exist.
- [ ] Run focused consumer and gateway tests; commit. Fresh reviewer audits protected-mode bypasses and the remaining-callsite inventory against actual source.

### Task 6: Whole-Branch Source Verification And Review

- [ ] Extend only ordinary credential-free PR tests/inventory as needed for the new Python and Node suites. Preserve workflow permissions, secrets, triggers, campaign jobs and citation offsets; independently review any workflow edit.
- [ ] Run actual Linux focused tests including real socket/fsync and all render positive/negative controls. Inspect exact-head CI logs and every new PR inline comment; no Windows skip counts as Linux proof.
- [ ] Run `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`; report every failure and skip accurately. Compare historical QA/history blobs and the frozen candidate ref with their baseline; do not stage bytecode caches.
- [ ] Obtain fresh whole-branch review, then request separate integration authority. Keep PR635 `do-not-merge` until the parent gateway Tasks 4-6 and all required source checks/reviews are actually complete. Source verification is not M1a certification or operational authorization.

## Execution Handoff

Execute sequentially with fresh implementer/reviewer gates because profile, capture, verifier and journal interfaces depend on each other. The plan and offline, fail-closed source sequencing are approved; the owner packet must be completed and independently reviewed before any production activation. Later live installation, provider pre-create binding, independent retention verifier, new candidate/freeze, D1, shipped-boot/keyed campaign and E5 certification require their own approvals and evidence; none is supplied by this source plan.
