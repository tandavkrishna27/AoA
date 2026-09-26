# M1a candidate reachability review: 28151ec8724f

**Candidate:** `28151ec8724fc94d3774845d9d23cac5411a489a`
**Measured (UTC):** `2026-09-27`
**Scope:** candidate-specific source reachability and campaign-allocation ledger; not campaign evidence or a gate verdict

These additive ledgers supersede the candidate applicability of the preserved `7be35ae6b771...`
ledgers without editing them. The earlier ledgers remain historical evidence for their named
candidate only. No earlier campaign result, runtime identifier, image digest, or provider identity
is adopted for `28151ec8724f`.

The review compared `7be35ae6b7719877e61f54ab552de84de8491e7d..28151ec8724fc94d3774845d9d23cac5411a489a`,
re-read every changed production path that can alter an E3-E6 row, reran the wiring caller census,
and inspected the frozen workflows, topology, fault matrix, provider-identity resolver, and campaign
verdict code. The current wiring guard reports **28 wired clauses, 6 declared dormant, and 2
intentionally deferred clauses**. The caller census is retained by the freeze review logs.

| Ledger | Candidate conclusion |
|---|---|
| [E3](./E3-job-control.md) | Production routes remain reachable; campaign-only tenant/cancellation claims remain campaign obligations. |
| [E4](./E4-worker-daemon.md) | Worker boot reachability remains, with new output/redaction paths; restart and cleanup injections still require fresh execution. |
| [E5](./E5-workspaces-secrets.md) | Staging/secrets/output mechanisms are source-reachable where declared; all seven audit clauses still require fresh candidate evidence. |
| [E6](./E6-deployment-test-harness.md) | The candidate harness includes material post-`7be` repairs and must be exercised fresh; old runs are not transferable. |

`Certified only by M1-D1-SPINE` below means the clause is allocated only to that fresh candidate
campaign. It does not mean the clause has passed. `Both` means both fresh campaign records owe it.
`M1a-D2-MECHANISM` means only that fresh mechanism campaign owes it.

**Entry disposition:** the E3-E6 candidate-ledger entry bullet is covered for this candidate's
source and allocation review. Freeze approval, dispatch, campaign pass, audit certification, and
milestone status are unchanged and remain pending.
