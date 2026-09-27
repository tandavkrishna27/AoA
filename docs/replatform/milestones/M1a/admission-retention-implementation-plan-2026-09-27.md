# M1a Local-First Admission and Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (requested) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Parent review of this written plan is required before execution; do not dispatch implementers or reviewers, change runtime code, or commit during preparation.

**Goal:** Build offline development tooling that exercises complete image admission and exact-version filesystem evidence verification without asserting H-08 approval, RET-01 compliance, or campaign clearance.

**Architecture:** Add an isolated `scripts/lib/m1a-dev/` module family beside the existing release gate. Compose the existing per-image PEM verifier with a development profile, then exercise manifest collection and put/head/get/retention through a private filesystem adapter outside Git. A separate development CLI verifies inputs and receipts; it cannot build, start containers, run campaigns, sign releases, or promote evidence.

**Tech Stack:** Existing Node.js >=20.3 ESM, built-in crypto/fs/path APIs, `node:test`, and existing pnpm checks. No dependencies or package/lockfile changes.

**Spec:** [admission-retention-design-2026-09-27.md](./admission-retention-design-2026-09-27.md), especially "Local-first development decision". Planning baseline: `C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5`, clean `codex/m1a-admission-retention-design`, HEAD `b6e577b41507e5c1360712ee870f4b085d387d96`.

## Global Constraints

- "The initial deliverable is development tooling and tests only: no AWS provisioning, cloud upload, provider campaign, trusted release signing or paid action."
- "Test signing keys likewise establish test behavior only, never H-08 approval." Caller-selected test roots are allowed only in this development harness; they are not the protected authority required for formal admission.
- "Its receipts must carry an explicit development-only classification; writable metadata or a local folder does not establish RET-01 compliance."
- All profiles, manifests, metadata and receipts require `classification: "DEV_ONLY"`; admission results require `h08Approved: false`, archive results require `ret01Compliant: false`. Human-visible receipts say `DEV ONLY / NOT H-08 / NOT RET-01`. Successful verification uses `status: "dev_verified"`, never a campaign `disposition: "pass"`.
- Private raw evidence, generated keys and receipts stay outside Git and outside OneDrive/shared/synchronized folders. Tests use synthetic data and ephemeral P-256 keys; no real credentials are requested, read or inherited by a child process.
- No AWS imports, S3 adapters, credentials, cloud/registry/provider calls, Docker execution, campaign dispatch or workflow success wiring. Do not import `run-e3-perf-01.mjs`: borrow its verification sequence only, preserving its dedicated namespace and contract.
- REL-004's five classes and existing image/installer/update admission signatures remain unchanged. No database, shared API, server or UI changes.
- Preserve every existing QA record, including the user-identified 85-record historical set, and all candidate refs byte-for-byte. Do not rewrite or append to historical assessments, allocate a campaign attempt, or claim retrospective approval. The worktree has 48 files in M1a's own `qa/`; the 85-record set must not be inferred from that subdirectory count.
- M1a remains fail; DEP-015 remains unestablished. No M1b/M2 promotion, release, certification, freeze replacement or paid campaign is authorized.

## Review Focus

1. A completely replaced policy/root/signature bundle: reject against the caller's separately pinned test authority; acknowledge that replacing the caller's authority itself is outside this harness's security claim (Task 1).
2. Shared image IDs across multiple Compose services, or duplicate service names: preserve the complete service set and reject ambiguous bindings (Task 1).
3. Windows junctions, case aliases, traversal and a repository nested beneath an archive root: reject unsafe evidence/store paths before creating anything (Tasks 2 and 3).
4. Concurrent writes, interrupted writes and later on-disk tampering: never overwrite or accept an incomplete version; readback must detect altered bytes/metadata (Tasks 2 and 3).
5. Cancellation or collector failure after initial collection: preserve diagnostics and cleanup observations, but refuse a verified receipt without final observations (Task 3).

## File Map and Existing Contracts

All future implementation files below are new. This preparation creates only this plan.

| New file | Responsibility |
| --- | --- |
| `scripts/lib/m1a-dev/policy.mjs` | Development profile signature, full inventory and per-image admission |
| `scripts/lib/m1a-dev/policy.test.mjs` | Synthetic signing and complete-set refusal tests |
| `scripts/lib/m1a-dev/filesystem-store.mjs` | Exclusive local versions and exact-version metadata/readback |
| `scripts/lib/m1a-dev/filesystem-store.test.mjs` | Real temporary-filesystem and injected fault tests |
| `scripts/lib/m1a-dev/evidence.mjs` | Closed manifest, secret checks, final collection and independent verification |
| `scripts/lib/m1a-dev/evidence.test.mjs` | Evidence validation and collector/readback refusal tests |
| `scripts/m1a-local-dev.mjs` | Strict development-only CLI; no campaign executor |
| `scripts/m1a-local-dev.test.mjs` | CLI subprocess and production-boundary regression tests |
| `docs/replatform/milestones/M1a/local-development-tooling.md` | Usage and limitations of the implemented tooling |

Read these existing sources before the owning task:

- `scripts/lib/image-admission.mjs`: reuse `evaluateAdmission(input)`, `canonicalSigningPayload({digest, sourceRevision})`, and `verifyDetachedSignature(payload, signature, publicKeyPem)` without editing them. Its caller-supplied trust root is test behavior, not formal authority.
- `scripts/lib/__tests__/image-admission.test.mjs`: ephemeral P-256 fixtures and positive-control-then-tamper tests.
- `scripts/lib/release-manifest.mjs`, `scripts/lib/__tests__/release-manifest.test.mjs`, `scripts/check-release-admission.mjs`, `scripts/check-release-admission.test.mjs`: preserve frozen five-artifact dispatch. The orphan guard scans top-level `scripts/lib/*admission*.mjs`; keep this separate profile under `m1a-dev/policy.mjs`, and give it explicit CLI reachability tests rather than weakening that guard.
- `scripts/run-e3-perf-01.mjs` (`performImmutableUpload`, `runCampaignCommand`) and `scripts/run-e3-perf-01.test.mjs`: model returned-version put -> head -> get -> retention and failure preservation, without running the campaign, importing its production adapter, or writing its pass records.
- `.github/workflows/m1-shipped-boot.yml`, `scripts/m1-shipped-boot/journey.mjs`, `docker-compose.staging.yml`, `docker/m1-boot/docker-compose.m1-boot.yml`, `docker/d1/m1-spine.override.yml`, `scripts/lib/m1-shipped-boot.mjs`, `scripts/lib/m1-shipped-boot-shape.mjs`, `scripts/lib/__tests__/m1-shipped-boot.test.mjs`, `scripts/check-m1-shipped-boot-shape.test.mjs`: references only. F3/DEP-015/E6-F030 source-build and truthful `builtFromSource` semantics stay intact.

## Shared Development Contracts

Use JSDoc typedefs in the owning module; these are JSON contracts, not a new shared TypeScript package.

- `DevResult<T> = {status: "dev_verified", classification: "DEV_ONLY", h08Approved: false, ret01Compliant: false, value: T} | {status: "refused", classification: "DEV_ONLY", h08Approved: false, ret01Compliant: false, reason: string}`. Validation functions return refusals for untrusted data; store I/O rejects with stable error codes, translated at the orchestration boundary.
- `ImageBinding = {service: string, digest: string, localImageId: string, source: {kind: "project", revision: string} | {kind: "external", identity: string}, provenanceSha256: string, sbomSha256: string, scanSha256: string, signature: string}`. Digests and local IDs are `sha256:` plus 64 lowercase hex; evidence hashes are 64 lowercase hex. Service names are unique. Multiple services may share one image ID.
- `DevProfile = {schema: 1, classification: "DEV_ONLY", policyId: string, policyVersion: string, candidate: string, authorityFingerprint: string, issuedAt: string, expiresAt: string, revokedDigests: string[], images: ImageBinding[]}`. Candidate/project revision are exact 40-hex SHAs. Times are valid UTC ISO timestamps; `issuedAt <= now < expiresAt`.
- `TestAuthority = {publicKeyPem: string, fingerprint: string, expectedPolicyId: string, expectedPolicyVersion: string, expectedCandidate: string}`. Fingerprint is SHA-256 of DER SPKI, verified from the key. Authority is an explicit caller input, never taken from the profile or evidence bundle.
- `RetentionMetadata = {classification: "DEV_ONLY", mode: "DEV_METADATA_ONLY", uploadedAt: string, retainUntil: string, ret01Compliant: false}`. Minimum exercise duration is `180 * 24 * 60 * 60 * 1000` milliseconds from the adapter's upload clock. This is mutable local metadata, not Object Lock COMPLIANCE or a retention guarantee.
- `VersionRef = {objectKey: string, versionId: string}`; keys use `m1a-dev/<campaignId>/<attemptId>/<bundleSha256>`, never `e3-perf-01/`. IDs are safe single path segments, generated UUIDs for versions; no latest-version reads or caller-provided version allocation.

### Task 1: Offline Development Image Profile

**Files:** Create `scripts/lib/m1a-dev/policy.mjs` and `scripts/lib/m1a-dev/policy.test.mjs`.

**Interfaces:**

- Produces `canonicalDevProfilePayload(profile: DevProfile): string`, fixed field order, sorted unique service names, binding all profile fields and image evidence hashes, with domain `aoa m1a development profile signature`.
- Produces `canonicalDevExternalImagePayload({digest, identity}): string`, fixed-key-order JSON `{type: "aoa m1a development external image signature", digest, identity}`. Task 1's external fixture signer uses these exact bytes.
- Produces `inventoryFromRenderedCompose(rendered: object, bindings: ImageBinding[]): DevResult<ImageBinding[]>`. Consume a previously rendered Compose JSON object; enumerate every service with an image, fail on unresolved variables, build directives, tag-only image references, omitted/extra services or nonmatching IDs. Do not shell out or render Compose in this task.
- Produces `verifyDevImageProfile({profile, profileSignature, authority, observedImages, evidenceByHash, now}): DevResult<ImageBinding[]>`. `evidenceByHash` is a map of hash to Buffer; `now` is epoch milliseconds. Rehash required provenance/SBOM/scan bytes before use. Observed images use the same binding shape and must match the signed set.

- [ ] Write failing tests `valid_profile_is_dev_only`, `complete_service_set_is_required`, `test_authority_cannot_come_from_bundle`, `profile_signature_binds_every_field`, `source_identity_is_truthful`, and `evidence_and_lifetime_are_required`. Assert valid fixtures produce `dev_verified` with both compliance flags false; then independently mutate an omitted/extra service, duplicate service, mutable tag, digest/ID, candidate, signature, authority fingerprint, policy ID/version, validity, revocation, each evidence hash or bytes. Each mutation must return `refused`.
- [ ] Add `shared_image_has_distinct_service_bindings`: two distinct services sharing one image pass; a duplicate service fails. Add `external_identity_never_uses_fabricated_project_revision`: external images require explicit synthetic external identity/provenance and return `refused` for unsupported formal/provider attestation; they never pass through fabricated project-source provenance.
- [ ] Run `node --test scripts/lib/m1a-dev/policy.test.mjs`; expect missing module/export or assertion failures before implementation.
- [ ] Implement the four interfaces. For project images compose `evaluateAdmission` with the pinned test root and an allowlist derived from the authenticated profile; require source revision equal to candidate. For external fixture images verify `canonicalDevExternalImagePayload` with the same test key. Do not treat that fixture signature as provider approval. Validate closed fields and every image's scan report explicitly declares `status: "dev_pass"` and binds its digest; reject missing/failed scans. No implicit signing helper outside tests.
- [ ] Run the task suite plus `node --test scripts/lib/__tests__/image-admission.test.mjs scripts/lib/__tests__/release-manifest.test.mjs`; expect all pass and unchanged five-class release behavior.
- [ ] After execution authorization, submit this bounded diff to a fresh reviewer; fix findings before Task 2. Commit only when the parent authorizes commits.

### Task 2: Private Filesystem Version Store

**Files:** Create `scripts/lib/m1a-dev/filesystem-store.mjs` and `scripts/lib/m1a-dev/filesystem-store.test.mjs`.

**Interfaces:**

- Produces `createDevFilesystemStore({root, forbiddenRoots, now}): Promise<DevStore>`, where `root` is an existing caller-provisioned private absolute directory, `forbiddenRoots` includes the checkout and Git common directory, and `now: () => number` supplies the clock. No cloud or environment credential input.
- `DevStore.putObject({objectKey, bytes, checksumSha256, ifNoneMatch: "*", retention: RetentionMetadata}): Promise<{versionId: string, checksumSha256: string, size: number}>`.
- `DevStore.headObject(ref: VersionRef): Promise<{versionId: string, checksumSha256: string, size: number}>`, `getObject(ref: VersionRef): Promise<Buffer>`, `getObjectRetention(ref: VersionRef): Promise<RetentionMetadata>`.

- [ ] Write failing tests `exclusive_version_survives_reopen`, `returned_version_is_mandatory`, `concurrent_duplicate_put_never_overwrites`, `partial_version_is_not_readable`, `unsafe_store_root_is_rejected`, and `retention_is_metadata_only`. Assert exact bytes/hash/size after reopening with a new adapter; duplicate puts have exactly one winner; a missing/wrong version fails rather than reading latest. Assert `COMPLIANCE` input, missing/short/invalid dates and checksum mismatch fail.
- [ ] Add real-filesystem tests for absolute/drive/UNC keys, `..`, backslashes, case-colliding keys, symlinks/junctions, and root containment in either direction with forbidden roots. Reject nonprivate/synchronized roots. On Windows use the existing directory's ACL to check current-user-only access (plus SYSTEM/Administrators); fail closed if ACL verification is unavailable, rather than pretending `chmod(0700)` secures Windows. A local platform ACL inspection is the only permitted subprocess here, with fixed executable/arguments, no shell and no credential access. Tests may inject ACL inspection results; include one Windows integration check when available.
- [ ] Run `node --test scripts/lib/m1a-dev/filesystem-store.test.mjs`; expect RED before module exists.
- [ ] Implement store creation and four methods. Reject reparse/symlink paths with lstat/realpath checks; require existing nonsynchronized private root, restrict newly created POSIX directories/files to 0700/0600, and inherit verified Windows private ACLs. Validate fixed lowercase key grammar and UUID version IDs. Use exclusive directory/file creation, generated version UUID and a completion marker written last; interrupted writes remain diagnosable but unreadable. No overwrite, deletion, retention mutation or fallback API. Generate `uploadedAt` at put time, independently validate the 180-day duration, and rehash bytes for Head/Get instead of echoing caller metadata.
- [ ] Run the task suite; expect PASS including concurrency and readback corruption cases. Document that application-level exclusivity cannot prevent a filesystem owner changing or deleting data and is not formal custody.
- [ ] Submit this task's diff for independent review before Task 3; no automatic commit.

### Task 3: Evidence Manifest, Collection and Independent Readback

**Files:** Create `scripts/lib/m1a-dev/evidence.mjs` and `scripts/lib/m1a-dev/evidence.test.mjs`.

**Interfaces:**

- Produces `collectDevEvidence({sourceRoot, campaignId, attemptId, candidate, policyId, requiredMembers, finalObservations, secretCanaries}): Promise<DevResult<DevBundle>>`.
- `DevBundle = {manifest, bytes: Buffer}`. Manifest schema 1 includes classification, campaign/attempt/candidate/policy identity, `redaction: "dev_checked"`, sorted `members: {path, size, sha256}[]`, and final observations `{runId: string, runAttempt: number, candidate: string, jobStatus: "completed" | "failed" | "cancelled", cleanup: "completed" | "failed", profileBundleSha256: string}`. Bundle bytes use a fixed-order JSON envelope containing that manifest and base64 member bytes; this is a development envelope, not a production archive format.
- Produces `archiveDevEvidence({bundle, store, retainUntil, now}): Promise<DevResult<DevArchiveReceipt>>` and `verifyDevArchiveReceipt({receipt, store, expectedIdentity, now}): Promise<DevResult<DevArchiveReceipt>>`.
- `DevArchiveReceipt` binds schema/classification, campaign/attempt/candidate/policy, bundle SHA-256/size, VersionRef, readback SHA-256 and RetentionMetadata, `h08Approved: false`, `ret01Compliant: false`. `expectedIdentity` explicitly supplies campaignId, attemptId, candidate and policyId from the caller. Reuse Task 2's exact-version methods.

- [ ] Write failing tests `closed_manifest_rejects_missing_extra_duplicate_or_unsafe_member`, `secrets_never_reach_store`, `put_head_get_retention_are_exact_version`, `independent_reopen_detects_tampering`, and `final_observations_required`. Assert extra/missing files, missing required logs/traces/profile/control/admission/job-status/cleanup members, size/hash mismatches, secret canaries or known PEM/bearer/provider-key patterns fail before put. Inspect actual bytes, not base64 text, for leaks. A missing redaction declaration or observation link refuses verification.
- [ ] Add `collector_failure_preserves_diagnostics_and_cleanup`, `cancelled_job_never_becomes_campaign_pass`, and `readback_or_retention_failure_has_no_verified_receipt`. Inject failures at put/head/get/retention, absent returned version, wrong returned version/checksum/size, changed classification, changed metadata, wrong lock mode and retention shorter than 180 days from uploadedAt. Assert source files remain byte-identical and no verified receipt is emitted. A fully observed failed/cancelled job may have a verified development archive, but never a passing campaign disposition.
- [ ] Run `node --test scripts/lib/m1a-dev/evidence.test.mjs`; expect RED before implementation.
- [ ] Implement collection with safe relative portable paths, no links/reparse points, deterministic sorted members and rejection of unlisted filesystem entries. Require final observations match manifest identity and the earlier profile bundle hash. Require caller-supplied `requiredMembers` be nonempty and include the evidence categories above; local fixtures define exact synthetic names. The CLI will use that explicit manifest contract rather than invent a full campaign evidence checklist. Check secrets before creating archive objects; do not echo offending bytes in errors.
- [ ] Implement archive operation: revalidate bundle manifest and bytes, compute hash, conditional put, take the returned version, head/get/retention at that exact version, recompute fetched hash/size and compare all identity/classification/retention fields. Independent verification repeats these operations using a reopened adapter and expected identity, without trusting success booleans in the receipt. There is no cleanup executor: observation collection failure leaves the original source alone and returns `refused`.
- [ ] Run all three new module suites; expect PASS. Run `node --test scripts/run-e3-perf-01.test.mjs`; existing archive/campaign contract must remain green and unchanged, with no real campaign invocation.
- [ ] Submit this task's diff for independent review before Task 4; no automatic commit.

### Task 4: Development CLI and Production Boundary Checks

**Files:** Create `scripts/m1a-local-dev.mjs`, `scripts/m1a-local-dev.test.mjs`, and `docs/replatform/milestones/M1a/local-development-tooling.md`.

**Interfaces:**

- Produces `runLocalDevCommand(argv: string[], {readFile, writeExclusive, createStore, now, repositoryRoots}): Promise<{exitCode: 0 | 1 | 2, result: DevResult<object>}>`; real CLI prints only the redacted structured result plus the development warning. Direct execution is guarded; importing for tests has no I/O side effects.
- Closed commands: `verify-images --mode development --profile <json> --profile-signature <file> --test-authority <json> --rendered-compose <json> --bindings <json> --evidence-dir <private-dir>`; `archive --mode development --input <private-dir> --contract <json> --store-root <private-dir> --retain-until <UTC> --output <outside-Git-json>`; `verify-archive --mode development --receipt <json> --expected-identity <json> --store-root <private-dir>`. Contract supplies identity, requiredMembers, finalObservations and synthetic secretCanaries for Task 3. Inputs containing private signing keys are refused; CLI never signs.
- Exit 0 means development verification only; exit 1 is validation/store refusal; exit 2 is unknown/duplicate/missing arguments or prohibited formal intent. Output is exclusively created outside Git, with no overwrites.

- [ ] Write failing tests `cli_reaches_real_development_verifiers`, `formal_intent_is_refused_before_io`, `relabelled_receipt_is_refused`, `output_cannot_enter_git`, and `no_campaign_or_provider_capability`. Verify a synthetic valid CLI round trip against a private temporary store and then tamper its exact version. Reject omitted development mode; `formal`, `production`, `campaign`, `promote`, `--pass`, cloud endpoint/credential options and unknown flags before reads/writes/store creation. Reject formal classification/compliance flags in input and reject replacing only the receipt's DEV labels. No environment-based mode fallback.
- [ ] Add `existing_formal_release_rejects_development_profile`: feed the DEV profile to the existing release admission CLI fixture and assert nonzero; do not modify its five-artifact contract. Add offline source-boundary tests asserting no workflow references `m1a-local-dev.mjs`, no new tool imports cloud/provider/campaign modules or spawns Docker/network commands, and no production success path consumes a DEV receipt. A test-only simulated start helper invokes the real Task 1 verifier immediately before incrementing a callback counter: valid bindings increment once, tampered IDs increment zero times. Implicit build/pull intent must fail inventory validation; the CLI rejects start/bypass options before I/O. The helper exists only in tests; it is not evidence of a production startup gate.
- [ ] Run `node --test scripts/m1a-local-dev.test.mjs`; expect RED before CLI exists.
- [ ] Implement strict argv parsing and Task 1/3 calls; compute repository/Git common roots for exclusion, require private paths, and write only DEV results. Treat CLI test-authority selection as explicitly caller-trusted development input, not protected policy bootstrap. `verify-images` must inspect evidence under safe paths and call both inventory and profile verification, closing the orphan gap without touching REL-004.
- [ ] Write the usage document with the three commands, synthetic key generation in tests only, caller-provisioned private root (example `C:/Users/TK/.aoa/m1a-dev`, subject to ACL checks), version readback, refusal codes, and DEV ONLY / NOT RET-01 limitations. No credentials, network setup or campaign walkthrough. Explain that changing development checks into formal authority requires a separate design and approval.
- [ ] Run focused checks: `node --test scripts/lib/m1a-dev/policy.test.mjs scripts/lib/m1a-dev/filesystem-store.test.mjs scripts/lib/m1a-dev/evidence.test.mjs scripts/m1a-local-dev.test.mjs scripts/lib/__tests__/image-admission.test.mjs scripts/lib/__tests__/release-manifest.test.mjs scripts/check-release-admission.test.mjs scripts/run-e3-perf-01.test.mjs scripts/lib/__tests__/m1-shipped-boot.test.mjs scripts/check-m1-shipped-boot-shape.test.mjs`; then `node scripts/check-m1-shipped-boot-shape.mjs` and `node scripts/check-evidence-immutability.mjs`. Expect all PASS, no historical-record change and unchanged shipped-boot shape.
- [ ] Run required source handoff checks: `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`. Expect exit 0 for each. Report unavailable dependencies/platform checks or baseline failures explicitly; do not silently mark them passed or widen scope to repair unrelated code.
- [ ] Review the complete diff, confirm manifests/lockfile/workflows and all pre-existing QA files are unchanged, then obtain whole-branch independent review. Commits/integration follow parent authorization; no campaign execution follows these checks automatically.

## Shipped-Boot Coverage and Deferred Formal Work

Task 4 reads and regression-checks `.github/workflows/m1-shipped-boot.yml`, the journey driver, staging and boot Compose files, image-chain fields and shape guards. Task 1 exercises their rendered inventory model with fixtures including the three project images, source-built MinIO and infrastructure; D1 fixtures also include fake-provider/infrastructure services. External/provider identities are synthetic and explicitly not approved. Do not assume three images exhaust either service inventory. Offline fixtures do not establish actual campaign coverage or prove a running container consumed those bytes.

No edits to the workflow, `journey.mjs`, Compose configurations, `docker/images/{build,sbom,sign,admit}.sh`, image-chain evidence writers or shipped-boot shape guards are in this implementation. The current journey records project image digests/revisions and MinIO `builtFromSource: true`; the shape guard expects the existing in-job chain. Replacing that chain with isolated build/owner-approval phases could change a normative contract, so obtain prospective owner disposition in a separate formal plan first. Task 4's simulated-start refusal tests establish the development interface behavior only, not live pre-start enforcement.

Future formal work must authenticate a protected policy authority/verifier outside candidate control, reject full authority/verifier replacement, approve external provenance/scan/revocation policy, bind built bytes again at actual startup, disable rebuild/repull/tag fallback, and wire final collector and independent controlled-store verification into assessments. Formal local storage needs owner-approved custody/access/backups/180-day durability and independent verification; an optional controlled cloud adapter needs separately authorized operational inputs. None of these requirements is discharged by this plan.

## Execution Handoff and Assumptions

- Parent reviews this document first. Subagent-driven execution is the preserved request, with one implementer and fresh reviewer per task followed by whole-branch review. Tasks run sequentially because their interfaces depend on earlier tasks. No agents or commits during plan preparation.
- The design's file header still says "proposed design". This plan relies on the user's explicit instruction to use the approved local-first section; it does not change that header or infer gate-owner rulings from it.
- A private nonsynchronized filesystem root can be provisioned by the caller before CLI use. Local access/metadata checks exercise refusal behavior and do not promise enforcement against the machine's owner or administrator.
- Previously rendered Compose JSON and synthetic observed bindings are available as test fixtures; obtaining live image inventory/build/scan/provider proof is deferred. Existing frozen SHA references are historical evidence, not the source candidate for future execution.
- Before implementation, record hashes/paths for all tracked pre-existing QA records under `docs/replatform/**/qa/` and preserve the complete set, including the named 85 records. Add no QA record in this work. Baseline expansion or a naming discrepancy is reported, never used to remove records.

Self-review: four bounded tasks cover development inventory/signature/refusal behavior, versioned local storage, closed evidence/final observations, and a nonpromoting CLI. Every Review Focus item has owning tests; shared names/types match between tasks. Formal gate/campaign integration is deliberately deferred by the local-first scope. Preparation verification is restricted to document/diff/scope inspection; runtime tests belong to execution after parent review.
