# E6 deployment and test-harness reachability ledger

**Candidate:** `d479709ed8940fe69ef28539daadb90b9b29310b`
**Prior candidate ledger:** `../28151ec8724f/E6-deployment-test-harness.md`

| Harness boundary | Candidate-current state | Fresh evidence obligation |
|---|---|---|
| D1 workflow | Workflow blob `bad51b4eabd416650ef65f2d8caec7f13dc63894` installs the root package's lockfile-pinned TypeScript compiler with scripts disabled before every host topology evaluator, then proves `require('typescript')`. | Rerun every required D1 job on this exact candidate; attempt 20's host dependency failure is not a result for this tree. |
| Matrix timeout | Fault-matrix job cap is 50 minutes, preserving every campaign, verdict, control, upload, teardown, and post-action step. | Job conclusion must be successful; the prior cancelled job is not converted or adopted. |
| Topology and shipped boot | Compose, shipped-boot workflow, evaluator, provider identity, and runtime packages are byte-identical to the prior candidate. | Retain fresh images, topology/config digests, exclusion ledgers, provider identity, and artifact-only verdicts. |
| Fault matrix | Declaration remains 29 required/2 pending for D1 and 17 required/9 pending for mechanism. | Every required case must fire; suppressed controls must decide; pending cases remain explicitly pending. |
| Cleanup and rollback | Mechanisms are source-unchanged. | Fresh cleanup evidence and D1 rollback rehearsal are mandatory. |

No workflow was dispatched for this review. Keyless/keyed sequencing, equivalent-run checks, paid
limits, and separate authorization remain unchanged. Failure authorizes no retry.
