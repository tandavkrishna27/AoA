# M1a AWS Archive Plan Addendum

Status: proposed implementation scope; written user review required before
implementation. This supersedes the local-only operational archive choice, not
the DEV_ONLY restrictions on offline tools, historical gate results, or H-08.

## Verified Setup

The user authorized Object Lock with default fixed COMPLIANCE retention of
180 days, then a separate scoped policy on the existing artifact IAM user.
No evidence upload or new campaign was authorized or performed by this setup.

- Account: `010438509726`.
- Bucket: `aoa-platform-evidence-010438509726-us-east-1-an`, `us-east-1`.
- Archive namespace: `replatform/m1a/`, within the authorized `replatform/` prefix.
- Versioning enabled; SSE-S3; bucket-owner enforced ownership; public access
  blocked in the console; Object Lock enabled with fixed COMPLIANCE 180 days.
- Uploader: `arn:aws:iam::010438509726:user/aoa-s3-artifacts`.
- New inline policy: `aoa-replatform-evidence-upload-verify`. TLS-only bucket
  configuration reads and prefix-scoped listing, PutObject, GetObject,
  GetObjectVersion, GetObjectRetention. No delete, retention-edit, or bucket
  administration grant. The old `aoatest` policy remains unchanged.
- Existing GitHub secrets: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

[Read-only diagnostic run 36306202421](https://github.com/MeteoriteLabs/AoA/actions/runs/36306202421)
completed successfully at `2026-09-27T08:26:43Z` on diagnostic commit
`0706bd4161fb3a9d2b849f1a1183945bd542a6df`, branch
`codex/aws-evidence-access-check`. Independent safety reviewer Ampere cleared
the diagnostic before push. It checked exact caller account/ARN, versioning,
SSE-S3, default Object Lock retention, and `replatform/` version listing. No
checkout, third-party action, object write, delete, policy change, or campaign
was executed. This is a throwaway diagnostic branch, not a candidate or PR to
merge into the program. Secret values were never extracted or disclosed.

This proves authentication and specified read access, NOT upload permission,
per-object retention, evidence custody, or independent RET-01 certification.
The frozen `d479709ed8940fe69ef28539daadb90b9b29310b` candidate is unchanged.

## Changes To The Earlier Design

The earlier local-first section remains an optional offline testing scope;
it is not the selected operational archive. Its mutable filesystem receipts
continue to say DEV_ONLY / NOT RET-01. Do not relabel those receipts.

For the selected S3 uploader, replace the earlier design's explicit retention
headers with inherited bucket-default retention followed by exact-version
verification. `PutObjectRetention` is not authorized. Do not import or invoke
the purpose-specific E3 performance campaign runner as a generic uploader.

The uploaded evidence and its verified storage facts are separate from image
admission and campaign disposition. Archiving historical D1 run 36284882342
cannot repair its historical H-08 failure or grant retrospective approval.

## Proposed Implementation Sequence

1. Define a separate archive contract binding the exact candidate, campaign,
   run ID/attempt, required artifact inventory, immutable source hashes/sizes,
   redaction assessment, and final job/cleanup observations. Reject missing
   members, path traversal, secret-bearing bytes, and identity mismatches.
   Source artifacts remain private and outside Git and synchronized folders.
2. Add `scripts/lib/m1a-archive/s3-store.mjs` and focused offline mock tests.
   Pin account, region, bucket and prefix; reject arbitrary destinations and
   endpoints. Use unique content-bound campaign/run-attempt keys, conditional
   create and SHA-256 checksum. Inherit the verified default retention: omit
   retention-setting headers and never issue retention-edit/delete/admin calls.
   Fail closed if configuration drifts; no local or unlocked-store fallback.
3. Add `scripts/lib/m1a-archive/evidence.mjs` and tests. Require the returned
   nonempty version ID. Head/Get/GetObjectRetention must target that exact
   version. Rehash retrieved bytes and verify size, service checksum, SSE-S3,
   COMPLIANCE mode and retention deadline. Never treat ETag as SHA-256 or use
   latest-version reads. Bind the observed creation/upload timing with explicit
   clock tolerance, verify the full 180-day interval from object creation and
   at least the campaign-required deadline; the exact time rule must be fixed
   in the detailed task plan before implementation. Preserve failures and
   cleanup observations without manufacturing a successful receipt.
4. Add a distinct archive CLI and `scripts/verify-m1a-archive.mjs` with tests.
   Output storage facts with status `uploaded_verified_pending_independent_review`,
   never automatic H-08 approval, `ret01Compliant: true`, or campaign pass.
   An independently controlled read-only execution identity repeats version,
   byte, retention and expected-manifest checks. Reject uploader self-certification.
   The verifier role, access policy and operator designation are not yet set up;
   their provisioning needs explicit permission approval. Preserve Hubble's
   eligibility for E5 certification only.
5. Run mock positive and negative controls before any live upload: wrong/missing
   version, short retention, checksum/size corruption, duplicate conflicts,
   destination/configuration drift, unauthorized APIs, secret leakage, collector
   failure and cancellation. Run focused regression tests, typecheck, tests and
   build; require independent code review and exact-head CI. Use existing
   dependency conventions; any new SDK requires manifest plus regenerated
   lockfile, never a lockfile-only edit.
6. Separately review the exact evidence set, sensitive-data access policy and
   upload/storage authorization before any live write. Verify actual exact
   versions independently and record an attributable RET-01 disposition. Bucket
   configuration alone is not compliance evidence. No upload probe is included
   in the already completed read-only diagnostic authorization.

## Remaining Approvals And Gates

Prospective Integration/Security image-scope, trusted-root, signer and provenance
policy approval remains unresolved. The TEST root is not formal authority.
Future runtime changes require a new candidate and independently approved
freeze; no old nonidentical-candidate evidence carry-forward or backdating.

Keep all historical QA records unchanged. Check the highest committed attempt
before allocating any successor. M1a remains FAIL; DEP-015 remains unestablished.
Only after applicable D1-owned conditions, H-08 and RET-01 independently pass may
planning authorize the keyless shipped-boot prerequisite, followed by the one
existing named F8 mechanism campaign. This addendum does not expand paid scope.

The local four-task implementation plan is not an AWS implementation plan.
Review this scope, then write/review detailed AWS tasks with concrete contracts,
time semantics, test cases and owners before subagent execution. Local developer
tools may remain optional, not a mandatory detour before the selected archive.
