# M1a admission and evidence retention design

**Status:** proposed design; not a gate-owner ruling or execution authorization.
**Integration branch:** `docs/replatform-program`.
**Scope:** repair H-08 and RET-01 prerequisites for M1a only. No M1b/M2
promotion, full REL-004 release, production cutover, or additional paid campaign.

## Intent and baseline

The user approved pursuing approved immutable images and controlled evidence
retention on 2026-09-27. Run `36284882342` on candidate
`d479709ed8940fe69ef28539daadb90b9b29310b` passed its execution checks, but
immutable D1 attempt 23 remains fail: ephemeral test-root signing does not
establish H-08 approval, RET-01 raw retention is only 14 days, and DEP-015
shipped boot was not run. Preserve all historical records and candidate refs.
Next D1 record is attempt 24 or higher; mechanism next is 26, subject to a
fresh allocation check. No retroactive image approval is permitted.

## Chosen approach

### Local-first development decision

The user selected local-first implementation and testing on 2026-09-27. The
initial deliverable is development tooling and tests only: no AWS provisioning,
cloud upload, provider campaign, trusted release signing or paid action.

Use a private filesystem archive adapter outside Git to exercise unique-version
creation, manifest integrity, readback, retention metadata and refusal controls.
Its receipts must carry an explicit development-only classification; writable
metadata or a local folder does not establish RET-01 compliance. Test signing
keys likewise establish test behavior only, never H-08 approval. Production
workflow paths must refuse development-only policy and archive receipts.

Formal local acceptance would require a separate owner-approved custody design,
access controls, durable backups, demonstrable 180-day retention and independent
verification. It is not granted by this development decision. S3 remains an
optional later controlled-store implementation, not an initial dependency or
requirement for local tests. Write the concrete implementation plan for this
development deliverable before source implementation.

Add a distinct M1a admission profile beside, not in place of, the closed
REL-004 five-artifact release manifest. Reuse the existing per-image admission
primitives in `scripts/lib/image-admission.mjs`. Build once per campaign, approve
the resulting inventory, and start only those approved bytes without rebuilding
between admission and startup. D1 and shipped boot may produce distinct inventories.

Add a distinct controlled campaign archive operation using the immutable
put/head/get/retention verification pattern in `scripts/run-e3-perf-01.mjs`.
Do not invoke the E3-PERF runner with D1 evidence or reuse its dedicated object
namespace. Keep its existing campaign contract and tests unchanged.

Alternative: self-approving images inside every test job retains the current
approval/identity gap. Expanding REL-004 to include unrelated M1a artifacts
changes the frozen release contract unnecessarily. Neither is selected.

## Image approval boundary

1. Enumerate images from the actual rendered Compose configurations and shipped
   boot runtime, including infrastructure, fake provider, and provider-managed
   identities where applicable. Do not assume only control-plane and worker.
2. The Integration and Security gate owners approve a prospective profile
   specifying the complete image set, permitted source/build identities,
   signer authority, public trust-root fingerprints or provider attestation
   policy, scan requirements, revocation policy, and approval lifetime.
3. Build candidate images in the campaign's isolated build phase. Retain digest,
   source revision, provenance, SBOM and scan identity. A separate authorized
   approval/signing step approves the exact digest inventory. The test job must
   not generate its own trusted signing root or possess the release private key.
4. Immediately before startup, verify complete-set equality, exact digest,
   source/provenance binding, trusted signature or owner-approved provider
   attestation, approval validity and revocation. Missing data refuses startup.
5. Resolve registry images by approved digest; bind locally built images to
   verified immutable image IDs and check the binding again at startup. Disable
   implicit Compose builds, tag fallback and repulls after admission. Each D1
   job records the actual digest set it consumes. Shipped boot follows the same rule.
6. A later build or changed digest requires new approval. Mutable tags and
   historical D1 digest approval do not authorize a later keyed rebuild.

The existing PEM verifier is the initial compatibility path for project-built
images. Do not substitute GitHub/Sigstore attestations without implementing and
reviewing a verifier for the approved identity policy. Provenance alone is not
approval. External image provenance must use an explicit approved verification
path, never fabricated project source revisions.

### Trusted bootstrap and build-contract compatibility

The owner-approved policy and root bundle must be authenticated by a protected
policy authority outside the candidate checkout. A separately reviewed controller
workflow/verifier, pinned by exact approved revision in protected configuration,
loads that authority and verifies a signed profile binding policy ID/version,
candidate, image inventory, roots, expiry and revocation policy. Candidate files,
workflow inputs and artifact bundles cannot select the authority or verifier.
Supplying an internally consistent replacement root/profile/signature must fail.
Environment approval and restricted workload identity must prevent untrusted
branches or fork workflows from obtaining signing or archive privileges.

Retain F3/DEP-015 and E6-F030: shipped boot builds the three project images and
its MinIO image from the frozen candidate in its own build phase. Approval occurs
after these builds and before any campaign container starts. Keep the driver's
local-image and truthful `builtFromSource` evidence semantics; do not replace them
with unsupported registry inputs or claim prebuilt images were built in the lane.
The implementation plan must explicitly cover `m1-shipped-boot.yml`, its journey
driver, Compose configuration, image-chain evidence and shipped-boot shape guards.
If isolated build/approval phases require a normative contract amendment, obtain
the prospective owner disposition before implementation of that change.

## Archive boundary

The recommended target is a private versioned S3 bucket/prefix with Object Lock
COMPLIANCE retention, encryption and least-privilege access. This is a proposed
operational choice, not a claim that RET-01 mandates one particular vendor or
that storage provisioning/spending is authorized.

For each campaign:

1. Collect all required logs, traces, manifests, profiles, controls, image
   admission receipts, workflow/job identities and cleanup results. Redact and
   fail on secret leakage before upload; never put generated raw logs in Git.
2. Create a manifest binding campaign ID, exact candidate, file paths, sizes,
   SHA-256 values, redaction result and archive policy identity. Refuse path
   traversal, duplicate names, unlisted files and missing required members.
3. Upload under a unique campaign/attempt prefix with conditional create,
   checksum and explicit retention at least 180 full days from upload. No
   overwrite or automatic fallback to local storage or expiring CI artifacts.
4. Verify the returned immutable version ID using exact-version HeadObject,
   GetObject and GetObjectRetention. Rehash retrieved bytes and validate size,
   checksum, COMPLIANCE mode and retain-until date.
5. A protected post-run collector archives final job status/logs and cleanup
   observations after all campaign jobs finish, linked to the earlier profile
   bundle by run ID, run attempt, candidate and hashes. Pre-cleanup uploads alone
   cannot prove final cleanup. Collector failures remain visible; cancellation
   must never fabricate success or erase diagnostic bundles.
6. An independent verifier repeats exact-version retrieval and retention
   checks. Commit only the structured receipt and redacted QA summary. Receipt
   references must not expose credentials or signed temporary URLs.

Archive failure blocks a passing QA disposition but must not skip cleanup or
erase local diagnostic evidence. Existing run artifacts may be archived before
October 11, 2026 to prevent loss; that cannot cure historical H-08 failure.
GitHub's public-repository retention ceiling cannot meet the 180-day floor.

## Operator inputs and authorization

Implementation can be developed and tested without real credentials. Actual
provisioning, signing, uploads and campaign execution remain blocked until:

- Named Integration and Security owners approve the prospective M1a profile.
- Registry location, trusted public identities, authorized signer and scan/
  revocation policy are supplied; private signing keys stay out of Git and tests.
- Archive bucket, region, prefix, authorized role, encryption/access policy and
  retention commitment are supplied and storage spending is explicitly approved.
- The exact redacted raw artifact set is approved for the private archive.

Use short-lived workload credentials where available; avoid embedding static
cloud credentials in the repository. Public-repository workflows must not expose
the private raw archive to untrusted pull requests or grant fork jobs signing or
archive credentials.

## Required verification

Admission tests must reject an omitted/extra image, mutable tag, altered digest,
wrong source revision, self-selected root, invalid signature, revoked approval,
expired approval, missing scan/provenance and bypassed pre-start verifier.
Also reject substitution of the entire root/profile/signature bundle, a changed
trusted verifier, and local tag rebinding or implicit rebuild after approval.
Demonstrate that refusal occurs before any campaign image starts.

Archive tests must reject checksum/size mismatches, absent version IDs, retrieval
of the wrong version, missing/short retention, wrong lock mode, overwrite,
missing evidence, secret leakage, unsafe paths and access failures. Verify that
failure preserves cleanup and cannot produce a pass receipt. Cover post-job
collector failure, cancellation and missing final cleanup observations.

Add focused workflow controls proving all runtime starts use admitted digests
and passing campaign assessments require independently verified archive receipts.
Run full typecheck, tests and build for source changes; independently review the
actual source and exact-head CI before integration.

## Execution and milestone sequence

After design approval, write and review a concrete implementation plan identifying
exact files, interfaces, tests and ownership. Implement through independent
review; obtain the operator inputs before external actions. Source/configuration
changes require a new candidate and independently approved replacement freeze.

Run fresh free D1 with pre-start admission and controlled retention, then grade
actual artifacts. Advancement requires independent verification of all D1-owned
required cases/controls, applicable hard invariants including H-08, and RET-01.
DEP-015 remains explicitly not established by D1; the aggregate M1a assessment
remains non-passing until the separate lane completes. Planning records the
attributable prerequisite disposition permitting keyless shipped boot, then the
single existing F8 named mechanism campaign after keyless evidence passes. This
does not waive DEP-015 or require a global passing assessment before its execution.
No repeat paid dispatch is authorized here. Complete immutable QA, explicit M1a
E5 audit and separate eligible certification, then a superseding non-promoting
handoff. Hubble remains excluded from implementation and relied-on decisions.

This design neither changes HARD/INITIAL thresholds nor grants campaign, epic or
milestone clearance. M1a remains fail until certified closure.
