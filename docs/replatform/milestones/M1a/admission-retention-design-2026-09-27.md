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

Add a distinct M1a admission profile beside, not in place of, the closed
REL-004 five-artifact release manifest. Reuse the existing per-image admission
primitives in `scripts/lib/image-admission.mjs`. Build once, promote approved
digests, and consume those digests in the campaign without rebuilding.

Add a distinct controlled campaign archive operation using the immutable
put/head/get/retention verification pattern in `scripts/run-e3-perf-01.mjs`.
Do not invoke the E3-PERF runner with D1 evidence or reuse its dedicated object
namespace. Keep its existing campaign contract and tests unchanged.

Alternative: rebuilding and signing inside every test job retains the current
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
3. Build and publish candidate images to the designated registry. Retain digest,
   source revision, provenance, SBOM and scan identity. A separate authorized
   approval/signing step approves the exact digest inventory. The test job must
   not generate its own trusted signing root or possess the release private key.
4. Immediately before startup, verify complete-set equality, exact digest,
   source/provenance binding, trusted signature or owner-approved provider
   attestation, approval validity and revocation. Missing data refuses startup.
5. Resolve all Compose image references by approved digest; disable build and
   tag fallback in campaign execution. Each of the three D1 jobs records the
   actual digest set it consumes. Shipped boot follows the same admission rule.
6. A later build or changed digest requires new approval. Mutable tags and
   historical D1 digest approval do not authorize a later keyed rebuild.

The existing PEM verifier is the initial compatibility path for project-built
images. Do not substitute GitHub/Sigstore attestations without implementing and
reviewing a verifier for the approved identity policy. Provenance alone is not
approval. External image provenance must use an explicit approved verification
path, never fabricated project source revisions.

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
5. An independent verifier repeats exact-version retrieval and retention
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
Demonstrate that refusal occurs before any image starts.

Archive tests must reject checksum/size mismatches, absent version IDs, retrieval
of the wrong version, missing/short retention, wrong lock mode, overwrite,
missing evidence, secret leakage, unsafe paths and access failures. Verify that
failure preserves cleanup and cannot produce a pass receipt.

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
actual artifacts. Only after passing assessment and authorized preconditions run
keyless shipped boot, followed by the single existing F8 named mechanism campaign.
No repeat paid dispatch is authorized here. Complete immutable QA, explicit M1a
E5 audit and separate eligible certification, then a superseding non-promoting
handoff. Hubble remains excluded from implementation and relied-on decisions.

This design neither changes HARD/INITIAL thresholds nor grants campaign, epic or
milestone clearance. M1a remains fail until certified closure.
