# M1a AWS Evidence Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development, as requested by the user. Steps use checkbox (`- [ ]`) syntax. The user approved the AWS scope addendum; review of this detailed plan is required before source implementation.

**Goal:** Build a narrowly scoped AWS evidence uploader and independent exact-version verifier, without treating storage success as image approval or milestone certification.

**Architecture:** A fixed-destination AWS CLI transport performs bounded S3 operations. Separate evidence validation and exact-version readback modules feed two strict CLIs, with uploader and verifier authority supplied outside the evidence bundle. Offline tests use synthetic bytes and injected transport functions; no live operations are part of implementation.

**Tech Stack:** Existing Node.js >=20.3 ESM, built-in crypto/fs/path/child_process, `node:test`, Python3 standard-library `zipfile` for bounded ZIP inspection, and operator-installed AWS CLI v2 for real operations. No new package dependencies or manifest/lockfile edits. Missing Python/AWS CLI fails closed; the tools do not install them.

**Spec:** [Approved AWS scope](./aws-archive-plan-addendum-2026-09-27.md), supplemented by [admission-retention design](./admission-retention-design-2026-09-27.md). Baseline: clean `codex/m1a-admission-retention-design`, commit `f391be9e1`, worktree `C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5`.

## Global Constraints

- Pin account `010438509726`, region `us-east-1`, bucket `aoa-platform-evidence-010438509726-us-east-1-an`, prefix `replatform/m1a/`.
- Uploader principal must be `arn:aws:iam::010438509726:user/aoa-s3-artifacts`. Existing GitHub secret names are `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`; never extract or print their values.
- Inherit fixed COMPLIANCE 180-day default retention. No retention-setting headers, PutObjectRetention, delete, bucket administration, provisioning, or local fallback.
- All source evidence, temporary raw bytes and receipts remain outside Git and synchronized folders. Tests use temporary synthetic data and must not inherit real AWS credentials.
- "Uploader readback is integrity checking, not independent certification." Return facts only, never `ret01Compliant: true`, H-08 approval, campaign pass, or automatic advancement.
- Existing local tooling stays DEV_ONLY. Do not import the E3 campaign runner or change its namespace, schema, tests or semantics.
- Keep all historical QA records and candidate refs byte-identical; allocate no new attempt in this work. Hubble remains reserved for E5 certification only.
- No campaign workflow integration, new image admission policy, signing, build, dispatch or live upload during implementation. Verifier permissions and sensitive raw upload authorization remain separate operator actions.

## Review Focus

1. Credentials or transport overrides change destination/identity: refuse before any PutObject (Task 1).
2. Compressed files hide secrets or unsafe members: inspect original ZIP contents without trusting sanitized entry names; refuse encrypted/nested/unsupported formats and oversized content before put (Task 2).
3. Clock skew or delayed independent review weakens retention: derive the duration from service version time, not receipt time or review time; enforce the campaign deadline without tolerance (Task 3).
4. An interrupted upload returns no usable version or duplicate conflict: no automatic retry or latest-version recovery; preserve source bytes and report uncertain outcome (Tasks 1 and 3).
5. A replaced receipt/contract or uploader self-verifies: bind independently supplied contract hash and verifier authority, reject DEV relabeling, and issue findings rather than certification (Task 4).

## Files And Contracts

New files only: `scripts/lib/m1a-archive/{s3-store,evidence,readback}.mjs` and matching `.test.mjs`; `scripts/lib/m1a-archive/inspect-zip.py`; `scripts/m1a-archive.mjs`, `scripts/m1a-archive.test.mjs`, `scripts/verify-m1a-archive.mjs`, `scripts/verify-m1a-archive.test.mjs`; `docs/replatform/milestones/M1a/aws-archive-operations.md`.

Read existing `scripts/run-e3-perf-01.mjs` immutable-upload sequence and `scripts/verify-e3-perf-01-handoff.mjs` read-only separation as references only. Use standard-library ZIP parsing rather than hand-parsing central-directory strings or trusting sanitized names. Helper invocation uses a fixed repository-relative file, no caller-selected module path.

Define JSDoc types in owning modules, not a new shared API package:

- `Identity = {account: string, arn: string}` from STS GetCallerIdentity.
- `ArchiveContract = {schema: 1, classification: "M1A_ARCHIVE_INPUT", candidate: string, campaignId: string, runId: string, runAttempt: number, qaAttempt: string, completedAt: string, requiredRetainUntil: string, members: Member[], finalObservations: Observation[], redactionReview: {reviewerId: string, reviewedAt: string, sourceInventorySha256: string}}`. Candidate is exact 40-hex; run ID decimal; attempt positive integer; QA attempt `a[1-9][0-9]*`. Campaign IDs safe lowercase path segments. No owner approval is inferred from this file.
- `Member = {path: string, sha256: string, size: number, format: "utf8" | "zip", artifactId: string, category: string}`. Hash is 64 lowercase hex, size positive safe integer. Required members/categories and final job names come from a separately pinned campaign inventory, never autodiscovered as sufficient. `Observation = {job: string, conclusion: "success" | "failure" | "cancelled", cleanupObserved: boolean, evidencePath: string}`. All expected jobs must have final observations; cleanup failure can be archived but never graded as a campaign pass.
- `PreparedArchive = {bytes: Buffer, sha256: string, size: number, contractSha256: string, identity: {candidate,campaignId,runId,runAttempt,qaAttempt}, requiredRetainUntil: string}`. Format is canonical UTF-8 JSON `{format:"aoa-m1a-archive-v1",contractSha256,contract,members:[{path,sha256,size,base64}]}` with fixed key order and sorted paths; raw member bytes remain byte-identical.
- `VersionRef = {key: string, versionId: string}`. Key is `replatform/m1a/<campaignId>/<runId>-r<runAttempt>/<qaAttempt>/<sha256>.json`. Reject traversal, percent escapes, backslashes, controls and extra segments. Version must be nonempty and not `null`; it is returned by S3, never caller-allocated for upload.
- `Store` methods: `identify(): Promise<Identity>`, `inspectConfiguration(): Promise<object>`, `put({key,bytes,checksumSha256}): Promise<{versionId,checksumSha256}>`, `head(ref): Promise<{versionId,size,checksumSha256,encryption,lastModified}>`, `get(ref): Promise<{versionId,bytes,checksumSha256,encryption}>`, `retention(ref): Promise<{mode,retainUntil}>`. Read-only stores expose no `put`.
- `UploadFacts = {schema:1,classification:"M1A_ARCHIVE_FACTS",status:"uploaded_verified_pending_independent_review",destination:{account,region,bucket,key,versionId},identity,contractSha256,sha256,size,uploader:Identity,putStartedAt,putCompletedAt,lastModified,retainUntil,requiredRetainUntil}`. No compliance or milestone booleans.
- `VerifierAuthority = {expectedAccount: "010438509726",expectedArn: string,reviewerId: string}` is independently pinned outside the bundle. It must designate a different read-only principal in the same account; no verifier ARN is invented in this plan. `ExpectedArchive = {contractSha256,sha256,size,identity,requiredRetainUntil}` comes from independent trusted inputs, not from upload facts alone.

### Task 1: Fixed-Destination AWS Transport

**Files:** `scripts/lib/m1a-archive/s3-store.mjs`, `.test.mjs`.

**Interfaces:** `createS3ArchiveStore({mode:"upload"|"verify",runAws,privateScratch,now}): Store`. `runAws(args:string[]): Promise<{code:number,stdout:string,stderr:string}>` is injected only by library tests; production CLIs use a module-private runner. Invalid inputs throw an error with a fixed non-sensitive `code`.

- [ ] Write tests `pins_account_region_bucket_prefix`, `rejects_transport_overrides`, `only_approved_operations`, `inherits_default_retention`, `conditional_checksum_upload`, `read_only_has_no_put`, and `uncertain_upload_is_not_retried`. Assert only fixed operations/argv are possible, exact owner on every S3 call, SHA-256 base64 checksum, `--if-none-match '*'`, `--server-side-encryption AES256`, and no Object Lock retention headers. 409/412/missing version/nonzero exit stops after one put. Errors never include raw stdout/stderr/credentials.
- [ ] Run `node --test scripts/lib/m1a-archive/s3-store.test.mjs`; expect RED for absent module.
- [ ] Implement the interface using explicit AWS CLI argv arrays, no shell. Command set: STS `get-caller-identity`; S3 `get-bucket-versioning`, `get-bucket-encryption`, `get-object-lock-configuration`, `put-object`, `head-object`, `get-object`, `get-object-retention`. Head/Get require `--version-id` and `--checksum-mode ENABLED`; parse ChecksumSHA256, VersionId, ContentLength, ServerSideEncryption and LastModified. Reject noncanonical checksum base64 and non-JSON responses.
- [ ] Production runner uses `execFile` with `shell:false`, `windowsHide:true`, 60-second timeout and 1 MiB stdout/stderr ceiling. Allow only PATH/system execution variables plus explicit AWS key/secret/session-token, fixed region and disabled metadata/pager. Reject AWS endpoint/profile/config/credential-file, proxy/TLS-disable and loader override variables rather than inheriting them. Require AWS CLI v2 and local `put-object --generate-cli-skeleton input` capability fields IfNoneMatch/ChecksumSHA256; missing executable/capability fails without provisioning or installing it.
- [ ] Private scratch contains exclusive generated files for upload/download; no caller-derived filenames. Refuse Git/synchronized roots, links/junctions and non-private directory access before writing. POSIX mode0700/0600; Windows ACL capability must be checked or fail closed, never claim chmod proves Windows privacy. Read returned download bytes then remove only generated scratch files; retain source files and diagnostic outcome. Tests include path aliases/junctions and incomplete downloads.
- [ ] Run Task 1 tests; expect PASS. Obtain fresh independent task review, then commit only Task 1 files after parent approval.

### Task 2: Closed Evidence Bundle And Redaction Checks

**Files:** `scripts/lib/m1a-archive/evidence.mjs`, `.test.mjs`, `scripts/lib/m1a-archive/inspect-zip.py`.

**Interfaces:** `prepareArchive({contract,expectedContractSha256,expectedJobs,requiredCategories,root,secretCanaries}): Promise<PreparedArchive>` and `validateArchiveBytes({bytes,expected}): Promise<PreparedArchive>`. Both operate offline and never call the store.

- [ ] Write tests `rejects_missing_extra_duplicate_members`, `binds_inventory_and_final_observations`, `preserves_raw_zip_bytes`, `zip_hidden_secret_refused`, `unsafe_original_zip_name_refused`, `nested_encrypted_binary_archive_refused`, `size_bounds_before_upload`, and `dev_relabeling_refused`. Synthetic secret canary inside ZIP must fail before any put; source ZIP stays byte-identical. Expected jobs/categories must be nonempty and separately supplied; contract substitution fails its independently expected hash.
- [ ] Run `node --test scripts/lib/m1a-archive/evidence.test.mjs`; expect RED.
- [ ] Implement canonical bundle serialization and manifest validation with safe portable relative paths, exact source size/hash, no links/reparse points, no unlisted source files and no duplicate/case aliases. Bounds: at most128 members, 64 MiB total raw member bytes, 128 MiB canonical bundle bytes, 4096 ZIP entries, 64 MiB total inflated inspection bytes, 64 MiB per ZIP entry. `inspect-zip.py` reads original archive bytes from stdin into bounded memory and uses `zipfile.ZipFile`/ZipInfo: check declared file sizes, names, duplicates, encryption flags and methods before decompression; read entries in bounded chunks with a cumulative inflated-byte cap. Permit STORED/DEFLATED only, strict UTF8 content, and ordinary directory entries with safe names; reject symlink entries and nested archives. Never extract files. Node invokes the helper without a shell, with no AWS credentials, 60-second timeout, bounded output and fixed Python3 executable (`python` on Windows, `python3` elsewhere). Return inspected entry text in bounded JSON consumed privately by the scanner, never CLI logs; malformed/oversized helper output fails closed. Unsupported binary formats fail closed; future support needs its own reviewed inspector, not a permissive flag.
- [ ] Scan decoded UTF-8 member content, ZIP inspection content and contract for supplied synthetic canaries and existing key/bearer/private-key/password patterns. Failure reports only fixed codes, never offending bytes. A redaction review declaration is required but cannot replace byte inspection or count as upload permission. Validate final observations and their referenced members without interpreting storage success as job success.
- [ ] Run Task 2 tests and Task 1 tests; expect PASS. Obtain fresh independent task review, then commit Task 2 files.

### Task 3: Exact-Version Readback And Retention Semantics

**Files:** `scripts/lib/m1a-archive/readback.mjs`, `.test.mjs`.

**Interfaces:** `uploadPreparedArchive({store,prepared,now}): Promise<UploadFacts>`; `verifyStoredArchive({store,ref,expected,authority,uploadFacts,now}): Promise<{classification:"M1A_ARCHIVE_VERIFICATION",status:"independently_verified_pending_owner_disposition",verifier:Identity,reviewerId:string,verifiedAt:string,facts:UploadFacts}>`.

- [ ] Write tests `put_returned_version_is_the_only_read_target`, `missing_wrong_version_checksum_size_refused`, `configuration_drift_refused`, `short_governance_retention_refused`, `delayed_review_uses_creation_floor`, `clock_skew_does_not_shorten_retention`, `uploader_identity_cannot_certify`, `tampered_receipt_contract_refused`, and `failure_or_cancelled_evidence_is_not_campaign_pass`. All read APIs must receive the put-returned version; independent verification uses the separately pinned ref/expected data, never latest.
- [ ] Run `node --test scripts/lib/m1a-archive/readback.test.mjs`; expect RED.
- [ ] Before put, validate approved caller, versioning Enabled, encryption AES256 and fixed COMPLIANCE Days180 without Years or event-hold substitutions. Record local put-start and put-complete times, issue one conditional put, then Head/Get/Retention at its returned version. Rehash retrieved bytes and compare prepared bytes, canonical bundle contract, service checksums, sizes, encryption, and returned version. Reject each failure without emitting upload success; preserve the known version ref on post-put failure for operator diagnosis without automatic write retries.
- [ ] Fix the exact time rule: let `createdMs = Date.parse(head.lastModified)`, `minimumMs = createdMs + 180*24*60*60*1000`. Require COMPLIANCE and `retainUntilMs >= max(minimumMs, Date.parse(prepared.requiredRetainUntil))`, with NO negative retention tolerance. Also require `createdMs` within `[putStartedMs-300000,putCompletedMs+300000]` and finite ordered local timestamps; the five-minute tolerance checks clock plausibility only. Independent review repeats the stored version's creation-based floor and original campaign deadline, not `reviewNow+180days`. Refuse expired retention at review time. S3's service creation timestamp is authoritative; do not round a short duration upward or backdate metadata.
- [ ] Independent verification obtains STS identity from its own transport and checks externally supplied same-account verifier ARN, distinct from uploader; revalidate destination, ExpectedArchive, bundle, version and all retention facts. Fixed output classifications contain no approval/pass booleans. Tests reject changing the uploader field in a receipt to evade comparison with the pinned uploader principal.
- [ ] Run Tasks 1-3 tests; expect PASS. Obtain fresh independent task review, then commit Task 3 files.

### Task 4: Strict Operator CLIs And Handoff

**Files:** `scripts/m1a-archive.mjs`, `.test.mjs`, `scripts/verify-m1a-archive.mjs`, `.test.mjs`, `docs/replatform/milestones/M1a/aws-archive-operations.md`.

**Interfaces:** `runArchiveCommand(argv,{readInput,prepareArchive,createStore,writeExclusive,now}): Promise<{exitCode:0|1|2,result:object}>`; `runVerifyArchiveCommand(argv,{readInput,createReadOnlyStore,writeExclusive,now}): Promise<{exitCode:0|1|2,result:object}>`. Injected capabilities exist for offline tests; real entrypoints build private fixed production capabilities and have no import-time side effects.

- [ ] Write tests `explicit_upload_intent_required_before_store`, `unknown_duplicate_options_refused`, `no_receipt_overwrite`, `no_arbitrary_endpoint_or_principal_override`, `real_modules_are_reachable`, `no_dev_receipt_promotion`, and `verify_cli_has_no_write_cloud_operation`. Import CLIs without credentials/network. Synthetic complete roundtrip uses real Tasks2/3 and mock transport; tamper a returned version and assert refusal before verified output.
- [ ] Run `node --test scripts/m1a-archive.test.mjs scripts/verify-m1a-archive.test.mjs`; expect RED.
- [ ] Implement closed upload flags `--contract`, `--expected-contract-sha256`, `--inventory`, `--input-root`, `--scratch-root`, `--output`, `--allow-upload`. Inventory supplies pinned expected jobs/categories and matches the contract review hash. Verify flags are `--facts`, `--expected`, `--authority`, `--scratch-root`, `--output`. Reject missing/duplicate/unknown flags, DEV inputs, arbitrary destination/endpoint, signing/dispatch/promote commands and output inside Git/synchronized paths. Environment credentials never appear in argv or output. Receipt output uses exclusive create; no overwrites. Exit0 means verified storage facts only, exit1 refusal/I/O failure, exit2 syntax/prohibited intent.
- [ ] Document that `--allow-upload` is an explicit mechanical safeguard, NOT authorization inferred by the agent. Live use additionally requires the operator-approved exact sensitive evidence set, destination/access policy and storage spend approval. No workflow is wired or dispatched by this task; the existing repository secrets are used only in an independently reviewed future protected runner. Distinct verifier role/provisioning and H-08 policy/root approval remain operator prerequisites. No root keys, extra access keys, broad bucket policy or automated certification.
- [ ] Run all new tests plus `node --test scripts/run-e3-perf-01.test.mjs scripts/lib/__tests__/image-admission.test.mjs scripts/lib/__tests__/release-manifest.test.mjs scripts/check-release-admission.test.mjs scripts/lib/__tests__/m1-shipped-boot.test.mjs scripts/check-m1-shipped-boot-shape.test.mjs`; then `node scripts/check-m1-shipped-boot-shape.mjs` and `node scripts/check-evidence-immutability.mjs`. Expect PASS and no historical evidence modification.
- [ ] Run `pnpm -r typecheck`, `pnpm test:run`, `pnpm build`; record any unavailable dependency/platform check or baseline failure, never claim it passed. Obtain whole-branch independent review and exact-head CI before integration against `docs/replatform-program`. Commit only reviewed files; no paid/provider/cloud write follows automatically.

## Execution And Operational Boundary

Run four sequential tasks with fresh implementers and fresh reviewers as requested, followed by whole-branch review. Parent self-review checks spec coverage, interfaces, exact tests, five Review Focus owners, and proportion before presenting this plan. Snapshot hashes of all tracked `docs/replatform/**/qa/` files before execution and compare after; do not interpret one subdirectory count as the entire historical evidence set.

This standalone tooling does not implement protected campaign image admission or campaign post-job collection. It requires already collected final observations and exact inventory; a future reviewed campaign-wiring plan must produce those. Any campaign source/configuration changes need a new candidate/freeze. Archive support alone does not complete M1a, permit M1b/M2 entry or expand the single named F8 paid authorization.

AWS setup and read-only credential diagnostic are complete. Detailed plan approval permits offline source implementation and its tests, not uploads, verifier permission changes, trusted signing or live campaigns. Independently verifying a historical archive may improve retention evidence only; it cannot retroactively change H-08 or rewrite a23.

References: [Object Lock duration semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html), [PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html), [HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html). S3 adds default duration to the object's creation timestamp; returned version and service checksums must be verified separately.
