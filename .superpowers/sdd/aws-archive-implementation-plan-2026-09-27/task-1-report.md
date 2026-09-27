# Task 1 Report

Status: IMPLEMENTED_FOR_REVIEW. Focused tests pass; independent parent review is pending. Windows real archive operations remain unsupported on this host until synchronization-root inventory is readable.

## Resumed Task and Parent Ruling

Parent confirmed that Get-Item SyncRootManager succeeds while Get-ChildItem is denied by the OS. Per the explicit resume ruling, the production Windows privacy check remains fail-closed, with no permission change, inventory bypass, or mock privacy claim. Parent authorized a narrow library-only facts capability and a local commit after focused verification. Full build/typecheck/Vitest are reported GREEN by parent; this worker did not rerun or independently certify those checks.

## Constructor Seam for Parent Ledger and Review

Library signature is now:
createS3ArchiveStore({mode,runAws,privateScratch,now,inspectWindowsPrivacy?})

inspectWindowsPrivacy(path): Promise<{sid:string,owner:string,protected:boolean,rules:Array<{sid:string,allow:boolean,rights:number}>,syncRoots:string[]}>

This returns Windows privacy facts, not an approval or bypass boolean. The owning module's real validator checks inventory availability, absolute sync roots and containment, owner SID, protected ACL, permitted principals, and full owner access. Missing/malformed inventory or a thrown capability fails SCRATCH_PRIVACY_UNAVAILABLE. Unsafe sync roots fail UNSAFE_SCRATCH; invalid ACLs fail SCRATCH_NOT_PRIVATE. Both put/get refuse before generated files and before any AWS call.

All real path/ancestor/Git/symlink/junction/name/environment-root checks remain outside the injected capability. POSIX owner/mode checks also remain real and cannot be bypassed by injecting Windows facts. Constructor shape validation now includes non-enumerable/symbol own keys.

Production signature stays exactly:
createProductionS3ArchiveStore({mode,privateScratch,now})

The production factory rejects own enumerable, non-enumerable, and inherited runAws/inspectWindowsPrivacy fields before environment setup. It constructs the library store with explicitly selected fields and only its private runner; no caller privacy capability is forwarded. Its default Windows path always calls readWindowsPrivacy and the real validator.

## Focused Verification and Self-Review

The resumed RED command ran before implementing the seam:
node --test --test-name-pattern='library_privacy|production_rejects_all' scripts/lib/m1a-archive/s3-store.test.mjs

Exit 1. Full output:

```text
✖ library_privacy_facts_are_validated_and_unavailable_inventory_refuses_without_aws (2.4704ms)
✖ production_rejects_all_caller_capabilities (1.3868ms)
ℹ tests 2
ℹ suites 0
ℹ pass 0
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 57.9073

✖ failing tests:

test at scripts\lib\m1a-archive\s3-store.test.mjs:157:1
✖ library_privacy_facts_are_validated_and_unavailable_inventory_refuses_without_aws (2.4704ms)
  Error: INVALID_INPUT
      at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
      at closed (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:19:119)
      at createS3ArchiveStore (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:148:3)
      at fixture (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:40:49)
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:158:35)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    code: 'INVALID_INPUT'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:181:1
✖ production_rejects_all_caller_capabilities (1.3868ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    Comparison {
  +   code: 'CREDENTIALS_REQUIRED'
  -   code: 'INVALID_INPUT'
    }

      at TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:186:12)
      at Test.runInAsyncScope (node:async_hooks:228:14)
      at Test.run (node:internal/test_runner/test:1118:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:787:18)
      at Test.postRun (node:internal/test_runner/test:1247:19)
      at Test.run (node:internal/test_runner/test:1175:12)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: Error: CREDENTIALS_REQUIRED
        at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
        at productionEnv (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:60:61)
        at privateRunner (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:68:15)
        at createProductionS3ArchiveStore (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:247:53)
        at assert.throws.code (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:186:25)
        at getActual (node:assert:611:5)
        at strict.throws (node:assert:759:24)
        at TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:186:12)
        at Test.runInAsyncScope (node:async_hooks:228:14)
        at Test.run (node:internal/test_runner/test:1118:25),
    expected: { code: 'INVALID_INPUT' },
    operator: 'throws',
    diff: 'simple'
  }
```

After implementation, all 19 then-current tests passed. Added an executable-boundary test showing the production factory attempts its real Windows privacy reader and refuses unavailable inventory with zero AWS invocations. The boundary executable is stubbed; this does not assert real inventory success.

Final focused command:
node --test scripts/lib/m1a-archive/s3-store.test.mjs

Exit 0. Full output:

```text
✔ pins_account_region_bucket_prefix (7.5899ms)
✔ rejects_transport_overrides (0.9291ms)
✔ only_approved_operations (7.1095ms)
✔ inherits_default_retention (5.0473ms)
✔ conditional_checksum_upload (4.8412ms)
✔ read_only_has_no_put (2.9512ms)
✔ uncertain_upload_is_not_retried (20.2631ms)
✔ rejects_invalid_refs_checksums_and_responses (2.6042ms)
✔ refuses_git_sync_aliases_and_nonprivate_scratch_before_writes (4.3621ms)
✔ library_privacy_facts_are_validated_and_unavailable_inventory_refuses_without_aws (17.2076ms)
✔ production_rejects_all_caller_capabilities (0.2299ms)
✔ production_uses_real_privacy_boundary_and_refuses_unavailable_inventory_without_aws (211.9968ms)
✔ incomplete_downloads_are_removed_without_removing_source_files (4.3314ms)
✔ key_digest_must_match_uploaded_bytes (0.644ms)
✔ upload_snapshots_validated_inputs_before_async_scratch_checks (3.9843ms)
✔ production_runner_is_private_bounded_and_capability_checked (43.4145ms)
✔ production_rejects_unsafe_environment_without_executing (43.1174ms)
✔ configuration_and_identity_mismatches_fail_closed (2.7773ms)
✔ successful_but_incomplete_download_fails_integrity_and_cleans_up (2.9594ms)
✔ production_missing_cli_or_capabilities_never_reaches_network_operation (173.7771ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 612.3952
```

node --check scripts/lib/m1a-archive/s3-store.mjs and node --check scripts/lib/m1a-archive/s3-store.test.mjs both exit 0, no output. git diff --check exits 0. Parent's full-check results are external to this worker's verification.

Self-review: confinement is tested for enumerable/non-enumerable/inherited capabilities. Privacy facts are validated against unsafe synced root/ancestor, wrong owner, unprotected ACL, Everyone access, insufficient owner rights, and unavailable inventory. Tests assert no files or AWS calls on refusal. Git and aliases/junctions use real temporary filesystem fixtures, with a successful mock OS-facts capability so failures prove the real path gate. Synthetic content upload/readback/cleanup and async input snapshot tests are GREEN. Canonical-path comparison respects POSIX case sensitivity and sync containment uses platform separators.

## Changed Paths and Remaining Limits

Only the authorized paths are included in the task commit:
- scripts/lib/m1a-archive/s3-store.mjs
- scripts/lib/m1a-archive/s3-store.test.mjs
- .superpowers/sdd/aws-archive-implementation-plan-2026-09-27/task-1-report.md

No existing tracked files/QA records changed. Branch remains codex/m1a-admission-retention-design in the designated isolated worktree. No subagents, real credentials, live AWS requests, uploads, provisioning, dispatch, pushes or external integration were used.

Windows unit tests use synthetic OS privacy facts plus real filesystem checks, not actual host privacy success. Actual Windows scratch-consuming operations remain unsupported here until inventory enumeration is readable. POSIX mode/owner behavior needs actual POSIX CI verification; no POSIX pass claim is made. The Windows executable-boundary refusal test is explicitly skipped on POSIX, while portable filesystem and injected-facts validator cases remain runnable.

Trusted Windows ACL principals are current user, SYSTEM, and Administrators. Review should examine inherited file ACL behavior and concurrent hostile local replacement risks, as well as completeness of synchronization-root detection for unregistered/custom synchronization software. No compliance, retention certification, campaign pass, or independent approval is inferred from synthetic tests.

Local commit is authorized and follows this report's recorded focused verification; its hash is provided in the handoff. Independent review remains with parent.

## Historical Initial Attempt

The following original NEEDS_CONTEXT report and output are retained as historical evidence, superseded by the resumed ruling and results above.


Status: NEEDS_CONTEXT. Implementation and tests are uncommitted. No completion or independent-review claim.

## Scope and authorization

Worktree: C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5
Branch: codex/m1a-admission-retention-design
HEAD remains 638e4892f. No branch switch, commit, staging, push, provisioning, dispatch, live AWS request, upload, or QA mutation occurred. No subagents were used.

Only these files were written:
- scripts/lib/m1a-archive/s3-store.mjs
- scripts/lib/m1a-archive/s3-store.test.mjs
- .superpowers/sdd/aws-archive-implementation-plan-2026-09-27/task-1-report.md

Tests created and cleaned only generated synthetic temporary directories. Their PowerShell processes received system variables and synthetic paths; production-runner child tests received explicitly synthetic credentials and mocked execFile. No real AWS executable was invoked or credential value extracted/printed. Existing tracked files have no diff against HEAD, preserving the parent's QA snapshot.

Read task-1-brief.md first, then shared-contracts.md/progress.md, CLAUDE.md, AGENTS.md, relevant architecture decisions and roadmap context. Source references were scripts/run-e3-perf-01.mjs:1287-1338 and scripts/verify-e3-perf-01-handoff.mjs:460-503 only. Applied the requested test-driven-development and verification-before-completion skills and the TDD writing-good-tests reference. Parent's current authorization supersedes the brief's earlier independent-review-before-commit sequence; independent review remains the parent's next action, but verification has not passed.

## Implemented work

Fixed account/region/bucket, validated prefix/key/version references, fixed allowed operations with argv arrays, expected owner on S3 calls, version/checksum-mode pinned reads, checksum/encryption/size/timestamp parsing, no put on verify stores, conditional checksum upload, inherited default retention without retention-setting headers, one put attempt, fixed sanitized error codes, and generated exclusive scratch files with cleanup.

Exported createProductionS3ArchiveStore({mode,privateScratch,now}) per ledger ruling. It wraps a private execFile runner with shell:false, windowsHide:true, 60-second timeout, 1 MiB stream ceilings, AWS CLI v2 and local skeleton checks, a restricted environment, disabled metadata/pager/default credential files, and AWS_MAX_ATTEMPTS=1. Missing CLI/capability tests never reach an AWS network operation.

Self-review found mutable caller input could change upload argv across async scratch checks. Added a failing regression test and snapshotted validated key/checksum/bytes before awaiting. Key digest now also must match uploaded bytes.

Checksums are canonical SHA-256 base64 in this Store interface; object-key digests are lowercase hex. now is accepted for constructor compatibility and is unused by this transport (no timestamps are fabricated).

## Blocking privacy finding

Windows ACL inspection is implemented using a fixed system PowerShell executable, SID comparisons, owner checks, protected root DACL, and an allow-list of current user/SYSTEM/Administrators. chmod is not used as Windows privacy proof. Git ancestors, named synchronized paths, environment sync roots, path aliases and junctions are refused.

Self-review identified that folder-name checks alone cannot prove exclusion from synchronized roots. Added read-only enumeration of registered Windows providers at:
Registry::HKEY_LOCAL_MACHINE/SOFTWARE/Microsoft/Windows/CurrentVersion/Explorer/SyncRootManager

The OS rejects enumeration: "Requested registry access is not allowed." Therefore the transport fails closed as SCRATCH_PRIVACY_UNAVAILABLE before creating a generated upload/download file or calling injected AWS. This is the actual blocker on this machine; no registry permission change was attempted. Do not remove or silently bypass that inventory check to get green tests.

Required parent context: an approved, independently verifiable way to establish that privateScratch is outside all synchronized roots when Windows SyncRootManager is unreadable, or an environment where the existing read-only inventory can be evaluated. Custom unregistered synchronization software also cannot be proved absent from folder-name detection alone. Privacy cannot currently be claimed.

No commit was made because the user's required sequence places focused verification before commit. Full typecheck, test:run and build were not run, as explicitly assigned to parent after Task 4. POSIX mode0700/0600 behavior is implemented but not exercised on this Windows host.

## Verification History

All commands ran in the specified worktree.

1. Initial RED, before implementation:
node --test scripts/lib/m1a-archive/s3-store.test.mjs
Exit 1, absent module as required. Full output follows.

```text
node:internal/modules/esm/resolve:275
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\Users\TK\.codex\worktrees\m1a-final-handoff\AoA-2.5\scripts\lib\m1a-archive\s3-store.mjs' imported from C:\Users\TK\.codex\worktrees\m1a-final-handoff\AoA-2.5\scripts\lib\m1a-archive\s3-store.test.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:275:11)
    at moduleResolve (node:internal/modules/esm/resolve:865:10)
    at defaultResolve (node:internal/modules/esm/resolve:991:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:719:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:736:38)
    at ModuleLoader.resolveSync (node:internal/modules/esm/loader:765:52)
    at #resolve (node:internal/modules/esm/loader:701:17)
    at ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:621:35)
    at ModuleJob.syncLink (node:internal/modules/esm/module_job:245:17)
    at ModuleJob.link (node:internal/modules/esm/module_job:345:21) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs'
}

Node.js v24.14.0
✖ scripts\lib\m1a-archive\s3-store.test.mjs (41.7233ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 46.0442

✖ failing tests:

test at scripts\lib\m1a-archive\s3-store.test.mjs:1:1
✖ scripts\lib\m1a-archive\s3-store.test.mjs (41.7233ms)
  'test failed'
```

2. First implementation run of the same full command failed during fixture setup: inherited PSModulePath prevented Windows PowerShell from loading Microsoft.PowerShell.Security/Get-Acl/Set-Acl. Fixed only the synthetic fixture environment and path delivery. This was not permission elevation or a privacy-gate bypass.

3. Same full command then passed 10/10 (exit 0, duration 19175.0821 ms) before registered-sync-root inventory was added. This result is superseded, not current completion evidence.

4. Added digest/production tests:
node --test --test-name-pattern='key_digest|production_' scripts/lib/m1a-archive/s3-store.test.mjs
RED: 1 pass / 2 fail, exit 1. key_digest_must_match_uploaded_bytes failed with Missing expected rejection. The other failure was a fake execFile missing Node's custom promisify result shape. Implemented the digest rejection and corrected the executable-boundary fake; rerun passed 3/3, exit 0, duration 815.5486 ms.

5. Additional negative checks:
node --test --test-name-pattern='configuration_and|successful_but|production_missing|refuses_git' scripts/lib/m1a-archive/s3-store.test.mjs
4/4 pass, exit 0, duration 5708.6408 ms, before inventory checking was added.

6. Async snapshot regression RED:
node --test --test-name-pattern=upload_snapshots scripts/lib/m1a-archive/s3-store.test.mjs
Exit 1, 0 pass / 1 fail. upload_snapshots_validated_inputs_before_async_scratch_checks failed with INVALID_RESPONSE at s3-store.mjs:228 after caller mutation changed argv/checksum. Implemented snapshots, but its post-fix full run is blocked earlier by inventory access; this fix is not yet independently proven GREEN.

7. Full focused run after inventory addition: 8 pass / 9 fail, exit 1. Read-only diagnostic confirmed SyncRootManager access denial. Final repeat below confirms the same current blocker.

8. Final focused command:
node --test scripts/lib/m1a-archive/s3-store.test.mjs
Exit 1. Full output:

```text
✖ pins_account_region_bucket_prefix (1243.1874ms)
✔ rejects_transport_overrides (560.8054ms)
✖ only_approved_operations (1229.2058ms)
✖ inherits_default_retention (1270.5193ms)
✖ conditional_checksum_upload (1222.0004ms)
✖ read_only_has_no_put (1175.4854ms)
✖ uncertain_upload_is_not_retried (1225.8945ms)
✔ rejects_invalid_refs_checksums_and_responses (2921.9845ms)
✔ refuses_git_sync_aliases_and_nonprivate_scratch_before_writes (1221.258ms)
✖ incomplete_downloads_are_removed_without_removing_source_files (1190.2184ms)
✔ key_digest_must_match_uploaded_bytes (544.5712ms)
✖ upload_snapshots_validated_inputs_before_async_scratch_checks (1129.5889ms)
✔ production_runner_is_private_bounded_and_capability_checked (65.5716ms)
✔ production_rejects_unsafe_environment_without_executing (71.5353ms)
✔ configuration_and_identity_mismatches_fail_closed (2784.3682ms)
✖ successful_but_incomplete_download_fails_integrity_and_cleans_up (1152.575ms)
✔ production_missing_cli_or_capabilities_never_reaches_network_operation (280.804ms)
ℹ tests 17
ℹ suites 0
ℹ pass 8
ℹ fail 9
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 19374.432

✖ failing tests:

test at scripts\lib\m1a-archive\s3-store.test.mjs:48:1
✖ pins_account_region_bucket_prefix (1243.1874ms)
  Error: SCRATCH_PRIVACY_UNAVAILABLE
      at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
      at windowsPrivacy (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:111:13)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async privateDirectory (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:132:39)
      at async scratch (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:170:18)
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:51:62)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    code: 'SCRATCH_PRIVACY_UNAVAILABLE'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:70:1
✖ only_approved_operations (1229.2058ms)
  Error: SCRATCH_PRIVACY_UNAVAILABLE
      at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
      at windowsPrivacy (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:111:13)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async privateDirectory (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:132:39)
      at async scratch (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:170:18)
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:72:63)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    code: 'SCRATCH_PRIVACY_UNAVAILABLE'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:83:1
✖ inherits_default_retention (1270.5193ms)
  Error: SCRATCH_PRIVACY_UNAVAILABLE
      at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
      at windowsPrivacy (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:111:13)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async privateDirectory (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:132:39)
      at async scratch (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:170:18)
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:87:3)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    code: 'SCRATCH_PRIVACY_UNAVAILABLE'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:92:1
✖ conditional_checksum_upload (1222.0004ms)
  Error: SCRATCH_PRIVACY_UNAVAILABLE
      at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
      at windowsPrivacy (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:111:13)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async privateDirectory (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:132:39)
      at async scratch (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:170:18)
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:98:20)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    code: 'SCRATCH_PRIVACY_UNAVAILABLE'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:108:1
✖ read_only_has_no_put (1175.4854ms)
  Error: SCRATCH_PRIVACY_UNAVAILABLE
      at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
      at windowsPrivacy (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:111:13)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async privateDirectory (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:132:39)
      at async scratch (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:170:18)
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:112:20)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    code: 'SCRATCH_PRIVACY_UNAVAILABLE'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:115:1
✖ uncertain_upload_is_not_retried (1225.8945ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  0 !== 1

      at TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:122:12)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:160:1
✖ incomplete_downloads_are_removed_without_removing_source_files (1190.2184ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    Comparison {
  +   code: 'SCRATCH_PRIVACY_UNAVAILABLE'
  -   code: 'AWS_FAILED'
    }

      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:165:3)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: Error: SCRATCH_PRIVACY_UNAVAILABLE
        at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
        at windowsPrivacy (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:111:13)
        at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
        at async privateDirectory (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:132:39)
        at async scratch (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:170:18)
        at async waitForActual (node:assert:646:5)
        at async strict.rejects (node:assert:769:25)
        at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:165:3)
        at async Test.run (node:internal/test_runner/test:1125:7)
        at async Test.processPendingSubtests (node:internal/test_runner/test:787:7),
    expected: { code: 'AWS_FAILED' },
    operator: 'rejects',
    diff: 'simple'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:176:1
✖ upload_snapshots_validated_inputs_before_async_scratch_checks (1129.5889ms)
  Error: SCRATCH_PRIVACY_UNAVAILABLE
      at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
      at windowsPrivacy (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:111:13)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async privateDirectory (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:132:39)
      at async scratch (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:170:18)
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:181:20)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    code: 'SCRATCH_PRIVACY_UNAVAILABLE'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:258:1
✖ successful_but_incomplete_download_fails_integrity_and_cleans_up (1152.575ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    Comparison {
  +   code: 'SCRATCH_PRIVACY_UNAVAILABLE'
  -   code: 'INVALID_RESPONSE'
    }

      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:262:3)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: Error: SCRATCH_PRIVACY_UNAVAILABLE
        at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
        at windowsPrivacy (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:111:13)
        at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
        at async privateDirectory (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:132:39)
        at async scratch (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:170:18)
        at async waitForActual (node:assert:646:5)
        at async strict.rejects (node:assert:769:25)
        at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:262:3)
        at async Test.run (node:internal/test_runner/test:1125:7)
        at async Test.processPendingSubtests (node:internal/test_runner/test:787:7),
    expected: { code: 'INVALID_RESPONSE' },
    operator: 'rejects',
    diff: 'simple'
  }
```

9. Syntax checks:
node --check scripts/lib/m1a-archive/s3-store.mjs
node --check scripts/lib/m1a-archive/s3-store.test.mjs
Both exit 0 with no output.

git diff --check exited 0; git diff --name-only HEAD and git diff --numstat HEAD had no output (new task files remain untracked; existing tracked files unchanged). git status --short --untracked-files=all showed exactly the two authorized source/test files. This scratch report is under the existing ignored .superpowers directory.

## Self-Review and Next Work

The implementation is a reviewable draft, not Task 1 completion. Nine tests require a provably safe scratch path and currently stop at privacy checking. Production capability/environment guards are exercised only with a stubbed executable boundary, never live AWS. The available tests do not yet prove POSIX behavior, every loader/environment variant, or concurrency against hostile local directory replacement. The Windows root DACL admits SYSTEM/Administrators as trusted OS principals; parent review should confirm that trust policy.

Independent review remains pending with the parent. Resolve the privacy context first, rerun the entire focused suite, review the final diff, then commit only the three authorized task files using the already granted local-commit authorization. Do not stage QA or other tracked files.

## Fix Round 1: Latest Authoritative Handoff

Status: REVIEW_FIXES_IMPLEMENTED, pending controller scoped rereview. Base: 2df404bc8. This appended section supersedes pre-review status and findings above; prior history is unchanged.

Read task brief, shared contracts, ledger, report, and affected source/tests. Applied receiving-code-review with the already active TDD and verification skills. All three findings were confirmed against the base implementation before fixes. No architectural ambiguity was resolved by weakening a gate: the controller explicitly pins 128 MiB, and get now performs an additional version-pinned HEAD from the existing approved operation set before download. This extra HEAD was announced before implementing it and is reflected in command-sequence tests.

### Important 1: Archive Ceiling and Bounded Download Reads

Both upload input and HEAD/GET ContentLength must be positive and at most 134217728 bytes (128 MiB); safe-integer metadata alone is no longer sufficient. Oversized upload fails before hashing/copying to scratch or invoking AWS. get performs a pinned HEAD after privacy checks and before GET, rejects oversized metadata, and requires GET size/checksum to match HEAD.

After download, actual path/held-file identity and file size are checked before allocating the result buffer. The descriptor is then read into a fixed expected-size buffer in at most 65536-byte chunks. Size is checked before allocation and around every chunk, followed by an extra EOF-byte probe, another size/identity/privacy check, and exact length/SHA-256 verification. No unbounded readFile or stream accumulation remains in the transport.

RED regressions covered oversized metadata acceptance, actual oversized sparse file with readFile forbidden, bounded reads plus growth between chunks, and valid chunked payload integrity. Additional GREEN coverage confirms equal-length corruption is rejected and incomplete/failed downloads still clean only generated files. Preflight bounds expected object size, not an adversarial external CLI's disk writes while its process is running; allocation stays bounded and oversized/mismatched files are refused afterward.

### Important 2: Windows Directory Inheritance and Actual Generated File Privacy

Directory and file inspections are distinct. Directory rules now include and validate numeric inheritanceFlags and propagationFlags. The owner must have full current access with ObjectInherit + ContainerInherit (3) and no propagation restrictions (0); a noninheritable owner rule is refused. Root DACL remains protected.

Immediately after exclusive creation of the generated EMPTY file, and before any source bytes are written or download AWS call, its actual DACL is inspected and validated. Owner and allowed principals remain current SID / SYSTEM / Administrators; effective full owner access is required and InheritOnly rules cannot prove it. An inherited file DACL may be unprotected, provided its actual rules satisfy the privacy checks. The file is also rechecked after download and after bounded reads. POSIX generated-file ownership/mode checks remain real (0600 creation plus owner/no group-or-other access validation), and path/link/file identity checks are real on both platforms.

Library-only seam is revised for parent ledger/review:
inspectWindowsPrivacy(path, {kind: 'directory' | 'file'})
returns {sid,owner,protected,rules:[{sid,allow,rights,inheritanceFlags,propagationFlags}],syncRoots}.

The production factory signature is unchanged, still rejects caller capabilities including inherited/nonenumerable fields, and never forwards this seam. Production reads real directory/file ACLs and real sync inventory; mocking either inspection is confined to library unit tests. Tests separately reject noninheritable directory access and a generated-file Everyone DACL, prove the file is empty at the failing privacy check, assert no AWS invocations, and accept a valid inherited private file DACL. Existing real Git/alias/junction tests remain intact.

Selected registry path: retain the existing fail-closed production implementation; no .NET replacement was attempted in this fix. Parent's corrected diagnosis confirms root enumeration is readable with .NET but a child provider is inaccessible. No provider is silently skipped or assumed safe. Windows real operation remains unsupported here until complete relevant inventory can be read. Mocked unit success is not proof of host privacy. POSIX still requires actual CI verification.

### Minor 3: Read Reference Snapshots

Validated key/version primitives are captured once before awaits. HEAD argv and response comparisons use the captured reference. GET preflight HEAD, GET argv, and both metadata comparisons use the same captured reference. Retention uses the same snapshot helper. Regression mutates the caller reference during HEAD and immediately while GET's scratch checks are pending; original pinned key/version and successful original-version integrity are preserved.

### TDD Evidence

RED command, before implementation:
node --test --test-name-pattern=round1_ scripts/lib/m1a-archive/s3-store.test.mjs

Exit 1. All five new regressions failed against the reviewed implementation. Full output (blank-line trailing spaces normalized):

```text
✖ round1_rejects_archive_above_128mib_before_download_or_upload (3.4259ms)
✖ round1_checks_actual_download_size_without_unbounded_readfile (6.3788ms)
✖ round1_bounded_reads_detect_growth_and_preserve_exact_checksum (3.9722ms)
✖ round1_directory_inheritance_and_generated_file_acl_checked_before_raw_bytes_or_aws (6.3239ms)
✖ round1_read_reference_is_snapshotted_before_async_calls (0.859ms)
ℹ tests 5
ℹ suites 0
ℹ pass 0
ℹ fail 5
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 75.5251

✖ failing tests:

test at scripts\lib\m1a-archive\s3-store.test.mjs:359:1
✖ round1_rejects_archive_above_128mib_before_download_or_upload (3.4259ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:363:3)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:358:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: { code: 'INVALID_RESPONSE' },
    operator: 'rejects',
    diff: 'simple'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:374:1
✖ round1_checks_actual_download_size_without_unbounded_readfile (6.3788ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    Comparison {
  +   code: 'SCRATCH_IO_FAILED'
  -   code: 'INVALID_RESPONSE'
    }

      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:384:3)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: Error: SCRATCH_IO_FAILED
        at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
        at scratch (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:191:7)
        at async waitForActual (node:assert:646:5)
        at async strict.rejects (node:assert:769:25)
        at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:384:3)
        at async Test.run (node:internal/test_runner/test:1125:7)
        at async Test.processPendingSubtests (node:internal/test_runner/test:787:7),
    expected: { code: 'INVALID_RESPONSE' },
    operator: 'rejects',
    diff: 'simple'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:389:1
✖ round1_bounded_reads_detect_growth_and_preserve_exact_checksum (3.9722ms)
  Error: SCRATCH_IO_FAILED
      at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
      at scratch (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:191:7)
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:407:21)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    code: 'SCRATCH_IO_FAILED'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:414:1
✖ round1_directory_inheritance_and_generated_file_acl_checked_before_raw_bytes_or_aws (6.3239ms)
  AssertionError [ERR_ASSERTION]: Missing expected rejection.
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:419:3)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: { code: 'SCRATCH_NOT_PRIVATE' },
    operator: 'rejects',
    diff: 'simple'
  }

test at scripts\lib\m1a-archive\s3-store.test.mjs:436:1
✖ round1_read_reference_is_snapshotted_before_async_calls (0.859ms)
  Error: INVALID_RESPONSE
      at fail (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:17:43)
      at readMetadata (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:178:143)
      at Object.head (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.mjs:218:14)
      at async TestContext.<anonymous> (file:///C:/Users/TK/.codex/worktrees/m1a-final-handoff/AoA-2.5/scripts/lib/m1a-archive/s3-store.test.mjs:443:17)
      at async Test.run (node:internal/test_runner/test:1125:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:787:7) {
    code: 'INVALID_RESPONSE'
  }
```

After implementation, the entire suite first passed 25/25. Self-review added valid-inherited-file/equal-length-corruption coverage and strengthened immediate reference-mutation coverage.

Final GREEN command:
node --test scripts/lib/m1a-archive/s3-store.test.mjs

Exit 0. Full output:

```text
✔ pins_account_region_bucket_prefix (8.3299ms)
✔ rejects_transport_overrides (0.7793ms)
✔ only_approved_operations (8.4355ms)
✔ inherits_default_retention (4.0456ms)
✔ conditional_checksum_upload (5.2545ms)
✔ read_only_has_no_put (3.1168ms)
✔ uncertain_upload_is_not_retried (20.2501ms)
✔ rejects_invalid_refs_checksums_and_responses (2.6587ms)
✔ refuses_git_sync_aliases_and_nonprivate_scratch_before_writes (4.8367ms)
✔ library_privacy_facts_are_validated_and_unavailable_inventory_refuses_without_aws (16.2024ms)
✔ production_rejects_all_caller_capabilities (0.187ms)
✔ production_uses_real_privacy_boundary_and_refuses_unavailable_inventory_without_aws (211.7808ms)
✔ incomplete_downloads_are_removed_without_removing_source_files (4.4443ms)
✔ key_digest_must_match_uploaded_bytes (0.5668ms)
✔ upload_snapshots_validated_inputs_before_async_scratch_checks (3.9909ms)
✔ production_runner_is_private_bounded_and_capability_checked (43.9049ms)
✔ production_rejects_unsafe_environment_without_executing (43.7829ms)
✔ configuration_and_identity_mismatches_fail_closed (2.9023ms)
✔ successful_but_incomplete_download_fails_integrity_and_cleans_up (3.0257ms)
✔ production_missing_cli_or_capabilities_never_reaches_network_operation (168.9765ms)
✔ round1_rejects_archive_above_128mib_before_download_or_upload (72.0023ms)
✔ round1_checks_actual_download_size_without_unbounded_readfile (4.0398ms)
✔ round1_bounded_reads_detect_growth_and_preserve_exact_checksum (7.2236ms)
✔ round1_directory_inheritance_and_generated_file_acl_checked_before_raw_bytes_or_aws (6.2627ms)
✔ round1_read_reference_is_snapshotted_before_async_calls (3.4645ms)
✔ round1_valid_inherited_file_acl_and_equal_length_corruption (10.7ms)
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 718.8411
```

node --check scripts/lib/m1a-archive/s3-store.mjs and node --check scripts/lib/m1a-archive/s3-store.test.mjs exit 0 with no output. git diff --check is clean. Full workspace typecheck/tests/build remain the controller's responsibility; this worker does not claim they were rerun. Earlier baseline checks reported by parent are not verification of the new fixes.

### Scope and Review Limits

Only scripts/lib/m1a-archive/s3-store.mjs, scripts/lib/m1a-archive/s3-store.test.mjs, and this appended task-1-report.md changed. Same isolated worktree/branch; all existing QA/candidate/history records untouched. No real AWS execution, uploads, credential extraction, OS permission changes, provisioning, dispatch, push, Hubble, or subagent/reviewer was used. Tests use synthetic temporary files, injected OS facts, stubbed AWS boundaries, and descriptor read interception to deterministically expose growth.

The controller authorized this local fix commit after focused verification. Its short hash is reported in the task handoff. Scoped independent rereview remains pending; no certification/compliance or production-platform readiness claim is made. Concurrent hostile privileged local ACL/path mutation and unregistered synchronization software remain platform threat-model limits for reviewer assessment.
