# M1a replacement candidate freeze inventory

**Recorded (UTC):** `2026-09-27`
**Candidate:** `c315e3ca462f8d8b77cb1777c53c76ef49dd873f`
**Candidate ref:** `refs/heads/codex/m1a-candidate-c315e3ca462f`
**Integration branch:** `docs/replatform-program`
**Status:** inventory prepared; planning freeze decision and independent freeze review pending
**Purpose:** replacement candidate inventory after PR #624; not a QA verdict, campaign authorization, or handoff

The candidate is the verified merge commit of PR #624. The dedicated candidate ref
resolved to the exact candidate when this inventory was prepared and must never move.
PR #623 and its `6d74d7e4e592...` freeze proposal are superseded and must not be merged or
used for dispatch. Earlier automatic runs remain diagnostic only. No earlier-candidate
campaign result is carried forward.

This record inventories existing evidence for a planning decision. The planning session
must take the freeze decision, and a separate eligible reviewer must verify this record,
its authorship boundaries, ancestry, pins, and current remote ref before any campaign.

## Ticket-result pins

Paths are under `docs/replatform/epics/`. The thirteen milestone results and the
independently approved DEP-027 successor are `complete` at the candidate. This table
does not grant a new acceptance or amend any immutable result.

| Ticket | Result path suffix | Git blob SHA |
|---|---|---|
| MIG-009 | E10-desktop-migration-realtime/tickets/MIG-009-wiring-result.md | `c82257da9899b26f9f60a73f423fd01e8d3911a5` |
| DAT-007-S3 | E5-workspaces-secrets/tickets/DAT-007-S3-result.md | `5e66a28f868bdfe8821bd19899e9f66d4f13f262` |
| E7-1-JOURNEY-ARM | E7-coding-e2b/tickets/E7-1-JOURNEY-ARM-result.md | `0afc60541607254fce86a1fd00e7e07be84c8d24` |
| WRK-013 | E4-worker-daemon/tickets/WRK-013-result.md | `d4c46a1b51923d3e7440cb0c3222a5b5b8e7d6ab` |
| WRK-018 | E4-worker-daemon/tickets/WRK-018-result.md | `ebad88a48cad04cf7b78f65d431cd4f1c989c6ea` |
| JOB-016 | E3-job-control/tickets/JOB-016-result.md | `339048ed6673665aefc5f3a1ad1ea97dac357948` |
| JOB-017 | E3-job-control/tickets/JOB-017-result.md | `568540de67215ae36283e165e41056143cf83717` |
| DEP-014 | E6-deployment-test-harness/tickets/DEP-014-result.md | `d5d7aa3f7dd70b0a63ebcc602a5cb3160cb946d7` |
| DEP-015 | E6-deployment-test-harness/tickets/DEP-015-result.md | `76d6735b118019acad657c1e42a25b4d1f8dac9c` |
| DEP-016 | E6-deployment-test-harness/tickets/DEP-016-result.md | `4f2f57b54b18317921fbbb6a35d8825a5c7fc80d` |
| DEP-017 | E6-deployment-test-harness/tickets/DEP-017-result.md | `e4dbd4b6221548321811adacc0945aab2c7feb02` |
| DEP-018 | E6-deployment-test-harness/tickets/DEP-018-result.md | `cc14feadef75b599e71020d94eac5aa20095fdef` |
| DEP-019 | E6-deployment-test-harness/tickets/DEP-019-result.md | `c8fd0b61c48a132d5f873be34e37add93dd5edcc` |
| DEP-027 (successor) | E6-deployment-test-harness/tickets/DEP-027-result.md | `247b2d1446b8f7245c519a6ea1e836f6ef74b329` |

## Candidate byte pins

Git blob hashes identify bytes in the candidate tree.

| Boundary | Repository path | Git blob SHA |
|---|---|---|
| D1 topology | docker-compose.d1.yml | `f6f47c21d9f6e25520782237b14d2d531f4b2673` |
| D1 worker override | docker/d1/m1-spine.override.yml | `0cd5d837144f3843428c68295315da9aea978c60` |
| Campaign environment | docker/d1/campaign.env | `4d3d0f2dbe26dd81aaf11a1c79a1e6d4a81eaa3b` |
| Worker profile | docker/d1/m1-spine-worker.profile.json | `75b882f5618c778f6b6440b108d0c62b51d0b87f` |
| Staging topology | docker-compose.staging.yml | `b45e411da9ca608f5e4da447f3b24f01f427a08b` |
| Shipped-boot overlay | docker/m1-boot/docker-compose.m1-boot.yml | `904f94ed747c51717122159b91273fd0694ac1c7` |
| D1 workflow | .github/workflows/d1-merge-train.yml | `da33625db2222c0e3495da9972b274a5df698407` |
| Shipped-boot workflow | .github/workflows/m1-shipped-boot.yml | `efecbc9d4c4e44f971b80252b381f721dab28b43` |
| Fault matrix | tests/d1/fault-matrix.json | `c3f6fc8417432e8fbe6b815eef30bd7c43fdd9b7` |
| E5 seven-clause matrix | docs/replatform/epics/E5-workspaces-secrets/audit-matrix/2026-09-21-e5-seven-clause-matrix.md | `4d8a43a55d760bfa6fe84b91c8854082ea488643` |
| Protocol manifest | docs/contracts/worker-protocol/v1/manifest.sha256 | `a5198560282b95e922a955fc48ffa8fe2eb67140` |
| Protocol package/version | packages/worker-protocol/package.json | `51dc7b2c67a1b60884219144a353b7e14e2162b3` |
| E2B package/version | packages/sandbox-e2b-provider/package.json | `9dd5527bb6fed328ba3e8d122e494b30b0ca902d` |
| Provider identity resolver | scripts/lib/m1-provider-identity.mjs | `26c246bb727351d94436a2276760d5de7342be85` |
| Redaction evidence | scripts/lib/d1-redaction-evidence.mjs | `1a8e09a3439689969727e1815f272cb82f3fa874` |
| Freeze evaluator | scripts/lib/m1-shipped-boot.mjs | `1b129e7730d8843a403b78c57bbed4e48df89df7` |
| Shipped-boot driver | scripts/m1-shipped-boot/journey.mjs | `e99ae9a62f121da353d163619cadc4aac65830ed` |
| Route composition root | server/src/app.ts | `792cecdcdc19d0c99b36da3e0cf80e586e3c7d24` |
| Root versions | package.json | `e61d0536511b578bf4ff0739cbb3d5fd45bb0ad4` |
| Dependency resolution | pnpm-lock.yaml | `d9e4fee2660f9612c4d734f0243de907f6b836d9` |

## Topology and exclusion manifest

D1 is the committed Linux topology with two control-plane replicas, separately
deployed workers, PostgreSQL, TLS MinIO, Toxiproxy, and the fake provider. The
single-worker M1 spine/fault-matrix override and `AOA_D1_CAMPAIGN=foundation`
foundation profile remain distinct. Worker protocol is v1. The fake-provider
profile is `d1-fake-m1-spine`, version 1. Runtime image, generated keypair, rendered
configuration, and policy digests must be retained and matched to candidate labels.

The exclusion ledger must be emitted from rendered and running state for every
control-plane replica. All categories are conjunctive:

| Category | Required frozen state | Source/mechanism |
|---|---|---|
| Workload | only `batch` plus `task_run` canary rollout for enabled Organizations A/B; control C absent | rendered/running rollout JSON and tenant-set evaluator |
| Desktop | absent | union of rendered and running Compose service names |
| Cross-target mobility | absent | TypeScript-AST inventory of the pinned `server/src/app.ts`; any mobility/handoff identifier or static/dynamic module provenance blocks absence |
| Cutover | off | `AOA_0188_CUTOVER_OPT_IN` unset/false |
| HA claim | not claimed | observed running control-plane count is recorded, not promoted into an HA claim |
| Hosted beta | off | `AOA_DEPLOYMENT_MODE` must not be `cloud_auth` |
| Crew | off | `AOA_DISTRIBUTED_CREW_ROLLOUT_ENABLED` unset/false |
| Tool surface | off | `AOA_DISTRIBUTED_TOOL_SURFACE_ENABLED` unset/false |
| Public ingress | off | `AOA_DISTRIBUTED_PUBLIC_SERVICE_INGRESS_ENABLED` unset/false |
| Cloud plugins | off | `AOA_DISTRIBUTED_CLOUD_PLUGIN_EXECUTION_ENABLED` unset/false |
| Unsandboxed multitenant | forbidden | `AOA_ALLOW_UNSANDBOXED_MULTITENANT` unset/false |

Any parse failure, unsupported identifiable mobility registration, category mismatch,
or rendered/running disagreement fails the record. The ledger and its source topology
manifest/digests must be retained with campaign evidence.

## Provider identity and paid boundary

Shipped boot builds control-plane, worker, and adapter-manager from the exact
candidate. The provider SDK is exactly `e2b@2.30.5`; the API endpoint is
`api.e2b.dev`; the requested alias is `aoa-base`. These names are not immutable
remote identity and no template ID, build ID, sandbox ID, or service version is
asserted in this freeze.

Before stack boot and before provider spend, the keyed lane must resolve `GET
/templates` to exactly one ready template and retain its provider `templateID`,
immutable UUID-shaped `buildID`, `buildStatus`, and available `envdVersion`. Every
observed sandbox must then be bound fail-closed to that exact template/build using
`GET /events/sandboxes/{sandboxID}` and the event's `sandboxTemplateId` and
`sandboxBuildId`. Missing, ambiguous, malformed, non-ready, changed, or mismatched
identity stops the lane. Actual values are runtime observations and must not be
invented in this document.

This closes EVID-01's immutable-template arm: `buildID` is the immutable template
build identifier, and the sandbox event binds each observed sandbox to it.
`envdVersion`, when the provider supplies it, is retained as a provider-returned
template-runtime identifier. It is not represented as a global E2B service release,
because the current API exposes no such identifier to this lane. EVID-01 still
requires the gate owner either to rule that retained `envdVersion` is the acceptable
equivalent service-side identifier, or to record that no global service version is
obtainable and that the immutable template build binding satisfies the condition
alone. This inventory does not take that ruling.

Keyless shipped boot comes first. One keyed run may occur only under the existing
named F8 authorization after preflight confirms no equivalent run is active or
complete. Failure authorizes no retry or additional paid run.

## Roles and authorship boundaries

| Role | Owner/state |
|---|---|
| Planning, freeze decision, partial-gate/rollback ownership, dispatch, handoff decision | calling M1 planning session under founder F2 delegation |
| DEP-027 implementer | `01a0dd9c-ec6d-7b12-a26a-f3e9783d4506` |
| Candidate inventory preparer; later campaign QA and E5 audit author | `01a0dd9b-ba6d-79a2-8d96-9651bf242b4e` |
| Freeze reviewer | pending; must be eligible and distinct from planning, implementation, and this inventory preparer |
| Reserved E5 audit certifier | `01a0de6b-915c-7fb0-b3d7-59e7bac3dc95`; excluded from implementation, dispatch, relied-on decisions, campaign QA/audit authorship, and handoff preparation |

Preparing this inventory is not taking the freeze decision. The future freeze
reviewer must explicitly verify these separations rather than relying on this record.

## Attributed planning ruling: PR #624 repair disposition

The following is the planning session's F2 ruling, recorded here with attribution;
it is not a decision by this inventory preparer:

> PR #624 is a candidate-level campaign-evidence repair, not an additional M1a
> required milestone ticket. No new ticket/result is required for this bounded
> harness-only correction: its exact reviewed implementation
> `f3362eea5b37f8986a7ed5de5d1723545f2646f4`, merged candidate
> `c315e3ca462f8d8b77cb1777c53c76ef49dd873f`, distinct independent CLEAR review,
> and all 16 CI checks passing are the repair disposition. This grants no campaign,
> audit, epic or milestone pass and does not rewrite frozen DEP-027; all thirteen
> required results remain unchanged, and fresh candidate-bound campaigns are still
> required. Adding a ticket would duplicate the already independently reviewed
> repair without changing acceptance or ownership. If this ruling is wrong, reopen
> it and add a separately approved repair result before any closure.

Evidence pins for that ruling are PR #624 head
`f3362eea5b37f8986a7ed5de5d1723545f2646f4`, merge
`c315e3ca462f8d8b77cb1777c53c76ef49dd873f`, and GitHub Actions run
`36264689552`, which completed successfully with all 16 checks. The independent
review was performed by the candidate inventory/campaign-QA session named above,
distinct from implementation and planning, and reported CLEAR on the exact head.

## Remaining pre-campaign gates

1. Planning must take and record the freeze decision for this exact candidate.
2. A separate eligible reviewer must approve the freeze inventory and authorship
   boundaries, re-resolve the candidate ref, verify ancestry and every blob pin,
   and run declaration, finding, citation, ticket-graph, and immutable-history guards.
3. Before a keyed campaign, the gate owner must record the EVID-01 service-identity
   disposition described above; no unavailable global service version may be invented.
4. The free exact-candidate D1 campaign must run after the approved freeze and
   retain all three jobs, artifact-only grading, suppressed-injection controls,
   full exclusion ledger, source topology manifest, and digests.
5. The keyless shipped-boot preflight must pass. Runtime provider identity must be
   captured as specified above before the single authorized keyed campaign.
6. New immutable campaign QA attempts must be authored from retained artifacts.
   A successor E5 audit must pin them and grade all seven clauses; a different
   eligible session must certify that audit.
7. Only then may planning prepare a higher non-promoting M1a handoff. M1a remains
   `fail` and M1b remains gated until that sequence completes.

Dispatch must use `candidate=c315e3ca462f8d8b77cb1777c53c76ef49dd873f`
and the remote candidate ref above must resolve to the same SHA immediately before
dispatch and in retained run metadata. The integration branch name is never a
candidate identity. No workflow was dispatched while preparing this inventory.
