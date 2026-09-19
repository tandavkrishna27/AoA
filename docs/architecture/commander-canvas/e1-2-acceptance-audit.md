# E1.2 acceptance audit â€” 2026-09-19

Status: incomplete. This audit preserves the full slice scope; it does not convert
fixture evidence or deferred consuming joins into acceptance.

## Authoritative inputs

- `slice-plans/e1-2.md`: both increments, connected acceptance, UAT and recovery.
- `coding-plans/e1-2.md`: transaction, checkpoint, ordinal and client requirements.
- `execution-sequence.md`: B03/B04 producers and B10/B15/B16/B20 consuming joins.
- Active Universe HEAD `a996d507bb54fa9d4623ffd6ca9a9c95d321d550` plus current working changes.
- Isolated combined candidate and exact source hashes: `evidence/reconciliation-2026-09-19/combined-candidate-checks.json`.

## Requirement-to-evidence map

Paths below are repository-relative. Passing counts are recorded runs, not a claim
that every requirement is covered by a single test or that the production UI exists.

| Requirement | Current evidence | Remaining acceptance |
|---|---|---|
| Owner/company/conversation authorization; no UUID-only receipt authorization | `universe-layout-ownership.test.ts`, `universe-layout-references.test.ts`, route tests and PostgreSQL ownership/revocation cases | Repeat through actual UI entry and its session |
| Strict bounded operations, schema and finite geometry | Shared validator and server reducer tests; route malformed-body rejection | Real-entry failure presentation |
| Atomic layout CAS, replayed complete receipt, changed-payload rejection | PostgreSQL integration concurrent first write, receipt replay and incarnation cases | Final adopted-source qualification |
| Transactional audit rollback without partial document or receipt | Real PostgreSQL injected audit failure and invalid final presentation cases | No additional producer gap identified in inspected evidence |
| Stable server ordinals, retry allocation, close/reopen and exhaustion | Real PostgreSQL ordinal retry/receipt/exhaustion; client generation reconciliation | Actual-entry lifecycle journey |
| Full viewport/order/selected/maximized snapshot, preserved restore rectangles | PostgreSQL coupled-presentation case; reducer/adapter and browser fixture tests | Production maximize/reload/restore journey |
| Owner/version checkpoint CAS and retention on panel close | Real PostgreSQL first-write race, version isolation, foreign reference and close-retention cases | Registered renderer consumers in E5.1/E5.2 |
| Checkpoint payload schema, exact 32KiB and failed audit rollback | Real PostgreSQL boundary/validation/first-write and update rollback; PATCH route tests | Renderer-specific restore/revocation and lost-ack consumer behavior |
| Generated migration and final source compatibility | Candidate fresh and upstream-0282 upgrade proofs, repeat no-op, Drizzle no drift | Adopt reviewed lineage only after upstream decision; active migration numbering still conflicts with newer upstream |
| Layout/receipt/checkpoint deletion cascade | Extended real PostgreSQL company removal test seeds a checkpoint, proves it exists, removes through companyService, then proves all three stores empty; 18/18 suite passed | Added test is on active base; candidate source fingerprint remains unchanged |
| Write-ahead bounded tab journal and safe overflow | `layout-journal.test.ts`, `useUniverseState.test.tsx`, connected workspace storage-failure tests | Actual-entry reload/storage-failure experience |
| Receipt-first uncertainty reconciliation, no speculative replay | Hook receipt/snapshot/recheck tests; lost-ack browser fixture | Real HTTP/DB browser journey |
| Independent property rebase; explicit same-property conflict | `layout-rebase.test.ts`, hook tests, two-tab browser fixture | Production two-tab acceptance |
| Owner switch/logout cancellation and recovery clearing | `universe-owner-isolation.test.tsx`, scoped hook tests | Production authentication transition |
| Hydrate without PATCH, preserve in-progress gesture, content and Undo | `PersistedUniverseWorkspace.test.tsx`, browser fixture saved-drag journey | Actual page entry |
| Smaller-screen/reduced-motion/keyboard behavior | Browser fixture narrow-screen journey | UAT in target host |
| Production mounting | Server `app.ts` mounts `universeLayoutRoutes`; source search finds `PersistedUniverseWorkspace` consumed only by `ui/src/dev/UniversePersistenceHarness.tsx` | E1.0/E2.4 authorized UI integration is absent, not merely untested |
| Full repository verification | Candidate build/typecheck pass; full run 24,842 pass/1 fail/76 skip; affected security suite 19/19 unchanged afterward | A single required all-green full run remains unproven; PostgreSQL fixture port race recorded separately |
| Product acceptance and rollback | Formal UAT register remains authoritative; feature rollback preserves data by contract | Tester acceptance and actual consuming disable/recovery proof remain required |

## Decision and next work

The user approved conditional upstream adoption for exact revision `75350f1`:
repair the isolated fixture, qualify, then adopt only if required checks pass.
Adoption is authorized only after the required checks pass. No live replatform work is changed.

Continue producer gaps on the existing base where independent. Do not add an
ad-hoc production route to bypass the approved E1.0/E2.4 ownership. Whole E1.2
remains open until its connected acceptance and UAT joins are proved.

## Connected-entry dependency revalidation

A current filesystem check confirms all three planned E2.4 outputs are absent:
`ui/src/components/universe/TaskConversationPanel.tsx`,
`ui/src/components/task-detail/TaskConversationContent.tsx`, and
`tests/e2e/universe-task-routes.spec.ts`.
Thus production acceptance cannot be obtained by simply rerunning the current
fixture. It requires the owning task-content/entry work and then the actual-host
acceptance join. Do not silently mark that dependency complete or substitute a
new mock entry. No qualification process remains running; the unrelated backend
container is the only running container and was left untouched.

The goal remains incomplete. The exact-base decision is now approved conditionally. Fixture repair and final
qualification are running in the preserved candidate; base adoption has not occurred.
