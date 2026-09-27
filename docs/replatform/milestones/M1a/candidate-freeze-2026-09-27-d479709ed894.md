# M1a replacement candidate freeze inventory

**Recorded (UTC):** `2026-09-27`
**Candidate:** `d479709ed8940fe69ef28539daadb90b9b29310b`
**Candidate ref:** `refs/heads/codex/m1a-candidate-d479709ed894`
**Integration branch:** `docs/replatform-program`
**Status:** proposed; pending independent freeze review and attributed planning approval
**Purpose:** replacement freeze after the D1 host-harness repair in PR #628; not campaign evidence, a QA verdict, gate pass, epic-status grant, or handoff

The candidate is the verified merge commit of PR #628. The dedicated candidate ref resolved to the
exact commit when this inventory was prepared and must never move. The historical freeze merged by
PR #625 and `refs/heads/codex/m1a-candidate-28151ec8724f` remain preserved for their named candidate;
they are not edited, moved, or reused. Attempts 19 and 20 remain immutable failed records for that
historical candidate. Any new result or correction starts at attempt 21 or higher.

No earlier-candidate campaign result, runtime identifier, image digest, provider identity, or QA
verdict is carried forward. This inventory records source state and planning boundaries only.

## Forty immutable blob pins

All hashes are full Git blob object IDs resolved from the candidate tree, except the six additive
entry-review files, whose bytes are pinned by `git hash-object` before this freeze file is added.

### Ticket-result pins (14)

| Ticket | Repository path | Git blob SHA |
|---|---|---|
| MIG-009 | `docs/replatform/epics/E10-desktop-migration-realtime/tickets/MIG-009-wiring-result.md` | `c82257da9899b26f9f60a73f423fd01e8d3911a5` |
| DAT-007-S3 | `docs/replatform/epics/E5-workspaces-secrets/tickets/DAT-007-S3-result.md` | `5e66a28f868bdfe8821bd19899e9f66d4f13f262` |
| E7-1-JOURNEY-ARM | `docs/replatform/epics/E7-coding-e2b/tickets/E7-1-JOURNEY-ARM-result.md` | `0afc60541607254fce86a1fd00e7e07be84c8d24` |
| WRK-013 | `docs/replatform/epics/E4-worker-daemon/tickets/WRK-013-result.md` | `d4c46a1b51923d3e7440cb0c3222a5b5b8e7d6ab` |
| WRK-018 | `docs/replatform/epics/E4-worker-daemon/tickets/WRK-018-result.md` | `ebad88a48cad04cf7b78f65d431cd4f1c989c6ea` |
| JOB-016 | `docs/replatform/epics/E3-job-control/tickets/JOB-016-result.md` | `339048ed6673665aefc5f3a1ad1ea97dac357948` |
| JOB-017 | `docs/replatform/epics/E3-job-control/tickets/JOB-017-result.md` | `568540de67215ae36283e165e41056143cf83717` |
| DEP-014 | `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-014-result.md` | `d5d7aa3f7dd70b0a63ebcc602a5cb3160cb946d7` |
| DEP-015 | `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-015-result.md` | `76d6735b118019acad657c1e42a25b4d1f8dac9c` |
| DEP-016 | `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-016-result.md` | `4f2f57b54b18317921fbbb6a35d8825a5c7fc80d` |
| DEP-017 | `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-017-result.md` | `e4dbd4b6221548321811adacc0945aab2c7feb02` |
| DEP-018 | `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-018-result.md` | `cc14feadef75b599e71020d94eac5aa20095fdef` |
| DEP-019 | `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-019-result.md` | `c8fd0b61c48a132d5f873be34e37add93dd5edcc` |
| DEP-027 successor | `docs/replatform/epics/E6-deployment-test-harness/tickets/DEP-027-result.md` | `247b2d1446b8f7245c519a6ea1e836f6ef74b329` |

### Candidate boundary pins (20)

| Boundary | Repository path | Git blob SHA |
|---|---|---|
| D1 topology | `docker-compose.d1.yml` | `f6f47c21d9f6e25520782237b14d2d531f4b2673` |
| D1 worker override | `docker/d1/m1-spine.override.yml` | `0cd5d837144f3843428c68295315da9aea978c60` |
| Campaign environment | `docker/d1/campaign.env` | `4d3d0f2dbe26dd81aaf11a1c79a1e6d4a81eaa3b` |
| Worker profile | `docker/d1/m1-spine-worker.profile.json` | `75b882f5618c778f6b6440b108d0c62b51d0b87f` |
| Staging topology | `docker-compose.staging.yml` | `b45e411da9ca608f5e4da447f3b24f01f427a08b` |
| Shipped-boot overlay | `docker/m1-boot/docker-compose.m1-boot.yml` | `904f94ed747c51717122159b91273fd0694ac1c7` |
| D1 workflow | `.github/workflows/d1-merge-train.yml` | `bad51b4eabd416650ef65f2d8caec7f13dc63894` |
| Shipped-boot workflow | `.github/workflows/m1-shipped-boot.yml` | `efecbc9d4c4e44f971b80252b381f721dab28b43` |
| Fault matrix | `tests/d1/fault-matrix.json` | `c3f6fc8417432e8fbe6b815eef30bd7c43fdd9b7` |
| E5 seven-clause matrix | `docs/replatform/epics/E5-workspaces-secrets/audit-matrix/2026-09-21-e5-seven-clause-matrix.md` | `4d8a43a55d760bfa6fe84b91c8854082ea488643` |
| Protocol manifest | `docs/contracts/worker-protocol/v1/manifest.sha256` | `a5198560282b95e922a955fc48ffa8fe2eb67140` |
| Protocol package | `packages/worker-protocol/package.json` | `51dc7b2c67a1b60884219144a353b7e14e2162b3` |
| E2B package | `packages/sandbox-e2b-provider/package.json` | `9dd5527bb6fed328ba3e8d122e494b30b0ca902d` |
| Provider identity resolver | `scripts/lib/m1-provider-identity.mjs` | `97245b4c527bdc2546d95c4a2640ce9774b55a93` |
| Redaction evidence | `scripts/lib/d1-redaction-evidence.mjs` | `1a8e09a3439689969727e1815f272cb82f3fa874` |
| Freeze evaluator | `scripts/lib/m1-shipped-boot.mjs` | `1b129e7730d8843a403b78c57bbed4e48df89df7` |
| Shipped-boot driver | `scripts/m1-shipped-boot/journey.mjs` | `e99ae9a62f121da353d163619cadc4aac65830ed` |
| Route composition root | `server/src/app.ts` | `792cecdcdc19d0c99b36da3e0cf80e586e3c7d24` |
| Root versions | `package.json` | `e61d0536511b578bf4ff0739cbb3d5fd45bb0ad4` |
| Dependency resolution | `pnpm-lock.yaml` | `d9e4fee2660f9612c4d734f0243de907f6b836d9` |

### Candidate-current entry-review pins (6)

| Review boundary | Repository path | Git blob SHA |
|---|---|---|
| E0-E2 dependency/delta | `docs/replatform/milestones/M1a/2026-09-27-e0-e2-delta-review-d479709ed894.md` | `32566543315c72cd5ae6734e72c271fef0116339` |
| E3-E6 index and complete matrix inventory | `docs/replatform/milestones/M1a/reachability/d479709ed894/README.md` | `2016350a38b46a171f48a898433ee05a896f2ec6` |
| E3 job-control | `docs/replatform/milestones/M1a/reachability/d479709ed894/E3-job-control.md` | `b600ec4e4f9977f7473eb3fdd0c523b4202fb9a5` |
| E4 worker-daemon | `docs/replatform/milestones/M1a/reachability/d479709ed894/E4-worker-daemon.md` | `0dc1513fada7fcbd0fdc597825c67925cfb59198` |
| E5 workspaces/secrets | `docs/replatform/milestones/M1a/reachability/d479709ed894/E5-workspaces-secrets.md` | `eb4b1c6997943d5919462b7b7f471cd9ac39bcd8` |
| E6 deployment/harness | `docs/replatform/milestones/M1a/reachability/d479709ed894/E6-deployment-test-harness.md` | `d9c8fef007176d15a756699d09888cc8b0cfc066` |

## Source delta and repair disposition

Relative to `28151ec8724fc94d3774845d9d23cac5411a489a`, candidate source changes only:

1. `.github/workflows/d1-merge-train.yml` installs the root package's lockfile-pinned TypeScript
   compiler with `--ignore-scripts --filter aoa`, proves `require('typescript')`, and raises the
   fault-matrix timeout to 50 minutes so post-action cleanup remains inside the bound.
2. `scripts/lib/__tests__/m1-spine-assertions.test.mjs` adds static assertions for that provisioning,
   install-before-preflight order, and timeout floor.

PR #628 exact head `ee07f09d5830455607263b1b4319a6d2c13c5fde` received Herschel's independent
**CLEAR** and passed required CI run `36278896363`; merge commit is this candidate. The repair fixes
the harness cause recorded by failed attempt 20. It does not rewrite that result, prove the campaign,
or carry forward the prior matrix observations.

## Frozen profile inventory

The full case-ID inventory is pinned in the candidate-current reachability README. Counts are:

| Profile | Required | Pending |
|---|---:|---:|
| `M1-D1-SPINE` | 29 | 2 |
| `M1a-D2-MECHANISM` | 17 | 9 |

These counts are source declarations, not results. Every required case needs fresh exact-candidate
evidence; every pending case remains debt. The D1 host fix and timeout change do not modify the
matrix file.

## Topology, exclusions, and provider identity

The prior freeze's topology, tenant set, exclusion categories, provider-identity contract, and
paid-run boundary remain byte-identical and are repinned above. A fresh campaign must emit rendered
and running exclusion state for every control-plane replica and retain all workload, desktop,
mobility, cutover, HA-claim, hosted-beta, crew, tool-surface, public-ingress, cloud-plugin, and
unsandboxed-multitenant categories. Any parse failure or rendered/running disagreement fails.

Keyless shipped boot precedes any separately authorized keyed run. Before provider spend, the keyed
lane must resolve one ready template and retain provider-returned `templateID`, immutable UUID-shaped
`buildID`, nonblank `envdVersion`, and per-sandbox event binding. Missing, ambiguous, changed, or
mismatched identity fails closed. No runtime value is invented in this freeze.

## Roles and approval boundary

| Role | Owner/state |
|---|---|
| Planning, freeze decision, dispatch, rollback, and handoff | M1 planning session `01a0d96c-ae64-7920-a1cb-af28a360c21c` under founder F2 delegation |
| PR #628 implementation | branch `codex/d1-typescript-runtime`, exact reviewed head `ee07f09d5830455607263b1b4319a6d2c13c5fde` |
| Candidate inventory and entry-review author | this session; distinct from implementation, planning, and independent freeze review |
| Independent freeze reviewer | pending; must review the exact freeze PR head and all 40 pins |
| Reserved E5 audit certifier | remains excluded from implementation, dispatch, relied-on freeze decisions, campaign QA/audit authorship, and handoff preparation |

The implementation CLEAR for PR #628 does not substitute for independent review of this freeze.
Planning approval is also pending and must be separately attributed after exact-head review.

## Required next steps

1. Submit this additive inventory in a freeze PR and obtain independent review on its exact head.
2. Require all PR checks green and resolve every review comment without rewriting an immutable record.
3. Obtain a separate attributed planning approval and land only with an exact-head guard.
4. Re-resolve `refs/heads/codex/m1a-candidate-d479709ed894` immediately before any authorized
   dispatch and prove no equivalent run is active or complete.
5. Run fresh free D1 evidence first; new QA starts at attempt 21 or higher. Then follow the approved
   keyless/keyed sequence and paid-run limits. Failure grants no retry.

No workflow, approval, paid provider action, campaign result, or merge is authorized by this
inventory. The integration branch name is never a candidate identity.
