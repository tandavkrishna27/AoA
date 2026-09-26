# E6 deployment and test-harness reachability ledger

**Candidate:** `28151ec8724fc94d3774845d9d23cac5411a489a`
**Baseline ledger:** `../E6-deployment-test-harness.md` at `7be35ae6b7719877e61f54ab552de84de8491e7d`

| Harness boundary | Candidate state | Fresh evidence obligation |
|---|---|---|
| D1 topology and merge train | Present and production-reachable through the committed D1 workflow/topology. Post-baseline changes include topology, override, image mirror, redaction evidence, cross-tenant suppression, and fault-matrix grading. | Run all required D1 jobs on this exact candidate; retain topology/config digests, injected/suppressed controls, and exclusion ledger. |
| Shipped CI boot | Present as `m1-shipped-boot.yml`; builds control-plane, worker, and adapter-manager from the named candidate. Candidate changes alter workflow and evaluator code. | Keyless preflight first, then at most one separately authorized keyed run. Old boot images, IDs, and verdicts are invalid here. |
| Provider identity | Preflight and pre-sandbox resolution fail closed on unique ready template identity, immutable UUID-shaped build ID, nonblank `envdVersion`, and per-sandbox event binding. | Retain provider-returned values and exact event bindings; do not invent a global service release. |
| Fault matrix | Frozen matrix is present. Campaign checker and assertion code changed after `7be`. | Every allocated case must show fired injection and red control where required. A declared `pending` case is not certified. |
| Artifact-only grading and redaction | Candidate includes output-root, secret-scan, redaction, and cross-tenant suppression checks. | Grade retained artifacts only. Console success or a prior candidate bundle cannot substitute. |
| Exclusions and rollback | Source evaluators cover workload, desktop, mobility, cutover, HA claim, hosted beta, crew, tool surface, public ingress, cloud plugins, and unsandboxed multitenant state. | Capture rendered and running state for every replica; execute the allocated rollback rehearsal. |

**Campaign limit:** no workflow was dispatched for this review. The free D1 campaign and keyless
preflight remain pending. A paid keyed run is permitted only after freeze approval, exact-ref
re-resolution, no-equivalent-run preflight, and the existing named authorization. Failure grants no
retry. No `7be35ae6...`, `c315e3ca...`, or PR-head campaign evidence carries forward.
