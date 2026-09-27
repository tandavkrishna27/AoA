# M1a Operational Approval Packet And Design

Status: independently reviewed proposal; operational review NOT CLEAR.
Not an execution or gate approval. User requested review/start; safe read-only
capability and source investigation started, production implementation held.
Baseline: `4aff3ac18b659e3b414a510370390f0d16431bb3` on
`docs/replatform-program`. PR634 is merged. M1a remains FAIL.

## Intent And Scope

Finish M1a with prospectively approved image execution, controlled final raw
evidence retention, independent verification and certification. Reuse the
merged archive and offline helpers; do not build another standalone mock
pipeline. Preserve tenant isolation, excluded scope, immutable QA/history,
REL-004's five artifact classes and the existing named F8 paid scope.

This document proposes operational boundaries. Approval of its design permits
a detailed implementation plan, not provisioning, signing, upload or dispatch.
The previously requested subagent-driven implementation/review method remains
the proposed execution method after written plan approval.

## Verified Starting Point

- PR634 exact source `92ed9f6cdd0b50b36c448bb70a197e44f40a5851` passed
  CI36334531174. Linux offline tests: 276 total, 275 passed, one Windows-only
  skip. Those tests are not operational H08/RET01 evidence.
- The repository is public. GitHub API returned zero environments on
  September27. Raw campaign logs/artifacts must not be uploaded here under
  the proposed private-evidence design.
- Production controller loading, complete start-path enforcement, custody and
  owner policy are absent. The six merged helpers explicitly refuse production.
- D1 workflow jobs are `d1-merge-train`, `m1-spine`, `m1-fault-matrix` in
  `.github/workflows/d1-merge-train.yml`. Separate shipped job `shipped-boot`
  lives in `.github/workflows/m1-shipped-boot.yml`.
- `scripts/m1-shipped-boot/journey.mjs` dispatches Docker through `composeArgs`;
  `tests/d1/lib/e6f-harness.mjs` independently issues Compose start/restart.
  Instrumenting only the initial workflow startup cannot enforce the boundary.
- Historical candidate `d479709ed8940fe69ef28539daadb90b9b29310b` and its
  immutable ref remain unchanged. Its successful execution is not retrospectively
  admitted or upgraded to a passing gate record.

## Approach Selection

Recommended: separate private trusted controller/evidence location, immutable
controller pins, isolated ephemeral Linux campaign execution and separate
signer/uploader/verifier custody. Candidate source is fetched at an exact full
commit; controller code is never loaded from candidate paths.

Alternative: protected controller branch in the existing public repository.
This can protect reviewed code, but does not by itself make job logs private or
isolate credentials. It is not the recommended raw-evidence execution location.

Alternative: operator-managed private Linux infrastructure. This can satisfy
custody but adds host provisioning, maintenance and access management. Adopt it
only if private Actions capabilities or costs make the recommended option
unsuitable; do not provision it as an implicit fallback.

The private location's actual repository name, billing/capability entitlement,
reviewer account and protected reference must be designated before deployment.
No external project is created by approving the choice of architecture alone.

Review correction: `MeteoriteLabs` is a user account, not an organization. Its
subscription was not exposed by the authenticated API. GitHub required deployment
reviewers for private repositories require an eligible Enterprise offering;
Free/Pro/Team do not supply that gate for private repositories. User has confirmed
Free or Pro, so private deployment reviewers are not the selected approval gate.
Use a separately controlled signed-approval mechanism only after its concrete
key custody, pinning, reviewer roles and replay/revocation design are approved.
Private storage
and branch review are not substitutes for deployment approval. Verify actual
entitlement before selecting that mechanism; otherwise separately design an
externally controlled signed-approval gate. Do not purchase an upgrade by inference.

Standard Linux GitHub-hosted runners provide passwordless sudo. Executing
candidate scripts on that host cannot preserve a same-host controller or Docker
restriction against candidate bypass. A separate unprivileged execution sandbox
with no host Docker socket, sudo, host filesystem write access or approval
credentials is required. The actual sandbox/privilege model must be selected and
reviewed before writing the production driver; a PATH wrapper is not enforcement.

## Trust And Execution Boundaries

1. A reviewed private controller owns the execution profile, authority public
   fingerprints, immutable controller revision and event allowlist. Protection
   requires independent review, enforced status checks, no routine bypass and
   authenticated pins outside candidate-controlled inputs. A signature whose
   root is selected by the candidate is not authority.
2. Candidate build/test execution has no signing key, archive credentials,
   privileged approval token or writable trusted controller checkout. It does
   not share a privileged Docker daemon with signer/uploader/verifier processes.
   A shared host with the Docker socket is not an isolation boundary.
3. Before application/infrastructure startup, the separate authority admits the
   complete inventory: project images, infrastructure, fake provider and any
   applicable real provider-managed template/build/runtime/sandbox binding.
   SBOM/scan tools themselves need approved identities and isolated execution;
   building an image is not permission to run arbitrary candidate processes.
4. Prefer daemon continuity within the isolated executor after build. If images
   cross hosts, the design must specify exact immutable export/import identity
   and re-verification. No tag fallback, implicit pull, rebuild or invented
   project provenance for external bytes is permitted.
5. Every execution-capable Docker operation must pass the trusted dispatcher,
   including up/create/recreate/run/start/restart/exec and dependency closure.
   Existing-container checks use container/image identities, not current tags.
   Direct alternate Docker paths must be denied at the boundary, not merely
   discouraged by helper imports. An audit inventories all actual call sites.
6. The dispatcher samples an independently controlled clock immediately before
   the operation; expired policy/binding or stale revocation refuses. Pure TEST
   helpers are reused only after production authority and clock adapters are
   separately specified and tested. In-process objects alone are not containment.

No production defaults, trust roots, signer keys or policy versions are assigned
by this draft. H08 owner approval must precede execution of each actual image
inventory. New builds require their own identities/admission.

## Evidence And Custody

The trusted collector observes all expected jobs through terminal post-actions,
captures final logs and actual teardown exit/residual/uncertainty observations,
then verifies post-cleanup redaction scan and private transfer. Scanner context
is private, non-uploadable and destroyed after the final scan; missing context
or runner loss is a refusal, never inferred cleanup success.

Raw files stay private throughout. Candidate outputs are untrusted data:
bounded decoding, path/symlink/hardlink refusal, secret scanning and exact byte
hashes precede approval. Public repository artifacts contain at most separately
reviewed sanitized summaries, not raw logs, policies with secrets or credentials.

Freeze exact per-job paths/categories, job/artifact identities and profile hash.
Every member category must belong to the approved profile. Preserve existing
archive limits: 128 members, 64 MiB raw, 128 MiB encoded, utf8/zip only. Unknown,
skipped, oversized, unsupported or missing evidence refuses completeness; no
silent truncation/filtering/splitting or schema enlargement.

Upload approval occurs after the final redacted bytes exist. It names their
inventory hash, canonical contract/bundle hashes and sizes, candidate/run/attempt,
destination, access and spending limit. One conditional upload follows approval.
Unknown write outcomes require operator reconciliation, not an automatic retry.

## AWS Recommendation

Keep account `010438509726`, region `us-east-1`, bucket
`aoa-platform-evidence-010438509726-us-east-1-an`, prefix `replatform/m1a/`.
Preserve private access, versioning, SSE-S3 and COMPLIANCE180-day default; inherit
retention without adding PutObjectRetention, delete or administrative permission.

Keep the approved uploader
`arn:aws:iam::010438509726:user/aoa-s3-artifacts` unchanged initially. Its credential
must be accessible only to isolated upload processing, never candidate jobs.
Separate review must decide whether this existing credential's other permissions
meet custody requirements; prefix restrictions alone do not erase old grants.

Provision a separately approved read-only verifier identity only after its exact
operator and IAM policy are reviewed. Permit only required configuration reads,
prefix-scoped listing and exact-version read/retention inspection. Deny upload,
delete, retention changes and administration. Prove effective permissions and
credential segregation; a different ARN alone is not independent control.

OIDC migration is a later separately reviewed amendment; do not silently replace
the fixed uploader identity. The verifier reads the exact returned object version
against independently prepared expectations, never uploader-derived hashes or
latest-version selection. Storage success and verifier success do not decide RET01.

## Approval Register

| Decision | Recommendation | Required before |
| --- | --- | --- |
| Owner appointment | TK as accountable Integration/Security and RET decision owner, with independent review; appointment not yet recorded | Prospective owner rulings |
| Controller location/protection | Private trusted location, full revision pin, independent human/account review and no routine bypass | Creation/settings changes and deployment |
| Image authority | Separate signer custody; complete-set signed policy, identity/provenance/scan/expiry/revocation rules | Signing and each image execution |
| Source-built handoff | Isolated daemon continuity or approved immutable transfer; preserve F3/DEP015/E6F030 semantics | Production driver implementation |
| Evidence profile/runtime | Exact D1 and separate shipped profiles, private Linux custody and fail-closed final collection | Campaign wiring/activation |
| Verifier | Named distinct operator and exact read-only AWS identity/policy | IAM provisioning and verification |
| RET disposition | Attributable owner decision bound to exact evidence and readback proofs | RET01 passing assessment |
| Upload/cost | Exact final reviewed bytes and explicit destination/access/spend bound | Each upload |

TK may own accountable decisions, but author/decision-reviewer/QA/certifier roles
remain separate. An agent review is not a GitHub account capable of clicking a
required-reviewer approval. Hubble is reserved solely for eligible final E5
certification and takes no earlier relied-on decision or implementation work.

## Staged Deliverables And Verification

Wave1: written owner/configuration packet and capability audit. Review private
Actions protection, billing and operator custody without changing settings.
Record accepted choices and rejection reasons; unresolved inputs stop only their
dependent operations. No new cloud/runner spending is approved now.

Wave2: detailed production wiring plan after written-design review. Map existing
workflow/journey/harness/image scripts to trusted boundaries. Specify executable
interfaces, complete service/build handoff and final evidence paths. Independent
review must challenge bypass paths and candidate-controlled authority before code.

Wave3: implement approved plan with fresh implementers/reviewers, no live secrets
in tests. Tests include alternate Docker bypass, tag/container substitution,
expired authority after waits, wrong candidate/run, extra/missing categories,
cleanup failure, runner loss, scanner-secret leakage and verifier/updater mixing.
Full typecheck/test/build and exact-head CI are required; deployment is separate.

Wave4: separately approve external setup and prove real private custody using
explicitly authorized non-sensitive controls. Freeze a NEW exact candidate and
complete dependency/result/config/version/owner pins; independently review and
approve its immutable ref. Never move historical refs.

Wave5: authorized fresh D1; exact final upload/independent verification/RET ruling;
separate keyless shipped boot; then the one named F8 mechanism campaign only after
its prerequisites. Diagnose failures before repeat spend. Independently authored
QA and explicit M1a E5 audit, eligible certification and non-promoting handoff
close M1a. No M1b/M2 entry follows merely from implementation CI.

Budget proposal: no new spend during design/offline implementation. Before any
private runner/storage activation, obtain a concrete quoted cost and a user-set
cap; no dollar amount or free entitlement is assumed. Existing F8 scope remains
unchanged and does not authorize extra campaigns or retries.

## Written Review Gate

User reviews this design and resolves the owner/location/operator choices.
Then prepare the detailed implementation plan, preserve the subagent-driven
method and obtain written-plan review before source execution. This document is
neither an approved policy nor a retrospective disposition for historical runs.

## Independent Review And Started Readiness Audit

Reviewer: separate read-only session Kierkegaard
`01a0e3e0-5364-7040-84f7-3921427e6557`, original design
`a0bae57cc05b2b6bb82bcb4110553d2c43377ab9`. No Hubble involvement.
Seven P1 operational-design findings remain open; do not describe this as
approved production wiring. The proposal's boundaries were accurately labeled,
but declarations alone do not implement them.

| Finding | Source checked by parent | Required closure before implementation |
| --- | --- | --- |
| Daemon bypass | Journey direct Docker spawn at line216; harness start/restart at3231/3242 | Concrete externally enforced socket/API boundary, denied alternate endpoints, constrained mounts/privileges/commands and adversarial host tests |
| Build/inspection bootstrap | sbom candidate execution fallback; shipped MinIO version execution | Separately authorized credential-free build/inspection isolation and approved scanner identities, before prospective runtime admission |
| Real-provider admission | real-transport.ts line213 creates by req.templateId; provider identity evidence is template/build/envdVersion | Mandatory keyed provider profile and supported immutable pre-create enforcement, or owner disposition that preserves H08; no fake OCI/provider attestations |
| Private execution from first byte | Existing public workflow log streams and uploads | Actual private entry point; inventory/replace all public raw producers before build/test, including provider/model credential containment |
| Durable terminal collection | D1 uploads precede teardown; teardown errors swallowed; journey deletes scanner state | Independent durable collector/state, preserved private scanner context, authentic teardown observations and cancellation/timeout/runner-loss reconciliation |
| Complete source/evidence profiles | Tags/local IDs/RepoDigests differ; source-built MinIO and D1 infrastructure differ | Per-profile typed image/build/service mappings and complete job/member manifest demonstrated within current limits |
| Operator independence | Proposed roles lack designated independent custody | Exact eligible operator/role/conflict matrix and independent expectation preparation; keep Hubble reserved |

Read-only capability audit completed: repository owner is a personal User account;
account API did not expose its plan. User then confirmed Free or Pro. Organization
API was unavailable and no token scope elevation was requested. No repository,
environment, IAM identity, host or subscription was created/changed.

Current source excerpts establish that this is not a small helper-import change:
the shipped journey uses up, force-recreate, run and exec as well as direct inspect;
the D1 harness independently starts/restarts. Current D1 raw uploads retain14days,
shipped uploads30days; final collector additions cannot undo earlier publication.
Teardown currently uses `|| true` in both workflows. These are investigation
observations, not new QA verdicts or measured custody proof.

Next work is to resolve the executor/approval mechanism and provider pre-create
contract, then write the task-by-task implementation plan against those selected
interfaces. Do not invent implementable interfaces while those choices remain
open, or execute the earlier completed offline plan again.

Primary capability references checked September27:
- https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
- https://docs.github.com/en/actions/reference/runners/github-hosted-runners

## Existing Server Discovery

User confirmed an existing private Linux server and previously supplied access.
Metadata/source inspection identifies `.github/workflows/deploy-replatform-campaign.yml`:
host `204.168.148.126`, port22, userroot, `/opt/aoa`, `/opt/campaign`, Compose
project `aoa-staging`. It consumes `DEPLOY_SSH_KEY1` and `DEPLOY_PASSPHRASE1`;
both secret names exist. Do not confuse the testing host in deploy-testing.yml
or its unsuffixed SSH secrets with this campaign host.

Latest recorded deployment35274876043 succeeded September17 atcbb496fe7.
This is historical connectivity evidence, not a current live host inspection.
GitHub does not expose secret plaintext; local SSH agent is unavailable and the
local SSH directory contains known-host files but no private key. Do not ask the
user to paste credentials or attempt to retrieve GitHub secret plaintext.

Existing deployment loads provider/model/AWS credentials and modifies campaign
files/builds/starts services. Do NOT dispatch it for a capability audit. A future
bounded diagnostic must use only existing SSH authentication, authenticated host
pinning and read-only system metadata; no deploy/restart/build/provider calls,
environment/secret-file dumps, logs, raw artifact upload or IAM changes.

Server availability changes the preferred next step to assessing this existing
host before proposing another server. It does not settle suitability, tenant
co-residency, kernel/VM isolation, Docker privilege, capacity, custody or approver
roles. Root SSH credentials must never be made available to candidate processes.
