# Protected evidence offline implementation

This is a development-only companion to the admission-retention design and AWS
archive operations. It is not a prospective H-08 policy, RET-01 disposition,
production trust anchor, deployment instruction or campaign authorization.
M1a remains FAIL; historical candidate refs and evidence are unchanged.

## Boundaries

The new helpers accept explicit synthetic TEST observations. Production inputs
refuse because owner-approved bootstrap, image policy, build handoff, evidence
profile, custody and upload/disposition authority have not been supplied.
They do not inspect a live Docker daemon, start a campaign, authenticate real
custody, provision IAM, upload through production credentials or sign images.
The inactive workflow fixture is symbolic text, not a registered workflow.

Protecting controller code/runtime and observations outside a candidate checkout
is still required. Same-process opaque objects prevent accidental boolean or
serialized receipt substitution; they are not a sandbox against a compromised
runtime or an approval of caller-supplied TEST authority.

## Modules

- `scripts/lib/m1a-controller.mjs`: signed, bounded TEST controller/context
  authentication; policy bytes are handed off through an opaque in-process
  capability. There is no production binding loader or approved root default.
- `scripts/lib/m1a-image-policy.mjs`: complete TEST service/provider inventory,
  source/build/SBOM/scan/signature/revocation checks. Local Docker config IDs and
  OCI manifest digests are distinct types. The existing REL-004 five-class
  release manifest is unchanged.
- `scripts/lib/m1a-start-guard.mjs`: prospective TEST pre-start checks. Real
  campaign journey, harness and Compose call sites remain unchanged; those
  paths do not acquire enforcement merely by importing a helper.
- `scripts/lib/m1a-final-evidence.mjs`: terminal TEST job/post-action logs,
  cleanup/scan/transfer observations and exact byte linkage are validated
  before creating the existing closed archive inputs. It does not perform
  teardown, retain scanner secrets or establish a custody channel.
- `scripts/lib/m1a-evidence-disposition.mjs`: injected TEST independent
  verification and review-eligibility links. Neither storage success nor
  review eligibility is an owner ruling or campaign PASS.
- `scripts/lib/m1a-protected-workflow-shape.mjs`: exact, finite inactive TEST
  source allowlist and mutation controls. It is not a general YAML or shell
  parser, operational driver or externally pinned controller.

## Failure and duplicate delivery

The TEST archive coordinator delegates to the existing injected archive command.
A returned exact version remains available after a later failure; a failure
without a validated version stays UNKNOWN. Neither outcome triggers a retry,
latest-version read or guessed reconciliation. Cleanup is independently
attempted and its outcome never becomes an invented success observation.

Duplicate suppression is bounded to one coordinator instance in one process.
It is not durable across restart or runner loss. Conflicting deliveries refuse.
Actual recovery, exact-version independent pins and operator reconciliation
remain separate responsibilities. Lost runners can lose diagnostics.

## Offline checks

Run the six new suites without cloud credentials or campaign execution:

```sh
node --test scripts/lib/__tests__/m1a-controller.test.mjs scripts/lib/__tests__/m1a-image-policy.test.mjs scripts/lib/__tests__/m1a-start-guard.test.mjs scripts/lib/__tests__/m1a-final-evidence.test.mjs scripts/lib/__tests__/m1a-evidence-disposition.test.mjs scripts/lib/__tests__/m1a-protected-workflow-shape.test.mjs
```

Focused tests supplement, not replace, repository typecheck, tests and build.
Current source needs independent integrated review and its own exact-head CI
before integration. These six suites are wired into the existing offline test step in the ordinary
PR workflow; no executable campaign workflow is added by this implementation.

## Production prerequisites

Before production wiring or a fresh campaign, obtain concrete owner decisions:

1. Protected controller location/revision, bootstrap pins, event allowlist and
   protected environment/reviewer rules outside candidate control.
2. Named Integration/Security owners and prospective complete-set image policy,
   signer/root/provider identities, scans, expiry and revocation semantics.
3. Reviewed source-built image handoff and immediately rechecked immutable
   runtime/container identity, including all start/restart/one-shot paths.
4. Approved exact job/member profile, terminal log and cleanup semantics, private
   scanner-context lifetime, transfer channel and unsupported-evidence handling.
5. Capable private runtime, fixed uploader custody and separately approved
   distinct read-only verifier identity, permissions and operator.
6. Exact sensitive redacted raw inventory/hashes, destination/access/spend
   approval and separately attributable RET owner disposition.

After source/config changes, independently approve a new candidate/freeze.
Never move the historical d479 candidate ref or retroactively admit its images.
Fresh D1, separate keyless shipped boot, the one existing named F8 mechanism
campaign, independent QA/audit certification and handoff remain later gated work.
No M1b/M2 entry follows from this development deliverable.
