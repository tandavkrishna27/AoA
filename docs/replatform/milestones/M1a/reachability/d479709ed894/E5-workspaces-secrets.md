# E5 workspaces and secrets reachability ledger

**Candidate:** `d479709ed8940fe69ef28539daadb90b9b29310b`
**Prior candidate ledger:** `../28151ec8724f/E5-workspaces-secrets.md`

PR #628 changes no E5 production source or seven-clause audit authority. Staging, secret
resolution, output export, audit/cost projection, tool-resolution isolation, and object cleanup
remain source-reachable as previously measured.

| Mechanism | Fresh exact-candidate allocation |
|---|---|
| Staging and secrets | Both profiles owe their named cross-tenant staged-input and secret cases plus profile-specific env observations and controls. |
| Output and readback | Both profiles owe their named output/read denials; mechanism export/refusal observations cannot substitute for D1. |
| Audit, cost, and tool resolver | Required `d1.*` and `d2m.*` cost/tool/legacy cases must each run; the M1a tool surface remains off. |
| Cleanup | D1 owns the required object-orphan injection; pending mechanism cleanup cases remain pending debt. |

This is source review only. A successor E5 audit must cite new immutable QA records for
`d479709...` and be certified by a separate eligible session.
