# CLI-018 — the founder-reachable artifact: make a distributed run's committed bytes retrievable

**Status:** merged in PR #645; live useful-work completion pending.
The merged `9925e8d87` typecheck, build and full local suite passed. Live run
`37378134451` produced no output; the MCP staging and harness mismatches are
being repaired in the [direct checklist](../../../milestones/M1a/recovery-plan-2026-09-26.md).
The October 5 founder instruction replaces the separate ruling/certification
prerequisite with direct code and tests. The implementation uses a board-only
content stream, with the authorization contract recorded in
[`docs/api/artifacts.md`](../../../../api/artifacts.md#download-a-distributed-task-output).
It does not mint a worker grant or a public download URL. Local PostgreSQL tests
cover committed bytes through the real projection and board route, wrong-company
and wrong-Organization denial, forged output references, terminal/rollout-off
reads and storage integrity. The viewer has an explicit download action.

The historical filing below describes the options before that implementation.

Filed 2026-09-24 by the **M1 planning session** under founder
delegation **F2**, on the measurement recorded in `../findings.md` `E7-F047`.
**Epic:** E7 · **Graph node:** `docs/replatform/program-design.md` `#### CLI-018` ·
**Plan task (the contract):** `../implementation-plan.md` `### CLI-018`
**Depends on:** `JOB-017` (shipped — the projection seam this rides) · **Blocks:** `M1b` exit
criterion 4
**Milestone:** `M1b` · **Owns:** `E7-F047`

★ **This file is a pointer, not a second specification.** The executable contract — Outcome, Files,
Interfaces, Failure behavior, Acceptance, the focused verify command, Non-goals and Evidence — lives
in **one** place, the E7 implementation plan's `### CLI-018` task. Two specifications drift; this
epic has a register full of what that costs. Read the task.

## Why this file exists at all

The same two mechanical reasons `CLI-017-design.md` records:

1. **`check-ticket-graph-coverage`** reads ticket ids from filenames under `epics/*/tickets/`; a node
   with no file is backlog, which `CLI-018` no longer is.
2. **`check-finding-ownership`** tests `tickets.has(entry.ticket)` (`findTicketIds`, the
   `/^([A-Z]+-\d+)/` derivation). `E7-F047` is re-pointed from `unowned` to `CLI-018`, and without a
   file on disk that declaration would fail `owner_ticket_missing` — a false ownership claim the
   guard exists to refuse.

There is no completion claim yet: the live useful-work check remains outstanding.

## In one paragraph

A distributed agent's artifact is durable in object storage and **unreachable by any
founder-available route** — seven routes measured, negatives included, tabulated on `E7-F047`.
`CLI-018` closes that. It presents **two options and chooses neither**: **(a)** materialize the
committed `job_artifacts` row into the product `artifacts`/`assets` tables so the existing routes and
`OutputRefTabBody` work unchanged, or **(b)** a founder-facing read route that mints a download grant
for a board actor, reusing the grant machinery that already exists. The choice is a later ruling,
because option (b) turns a **worker credential surface** into something a board session can reach,
and that authorization analysis has not been done — the task makes it a **precondition of the
option**, not an afterthought. Under ruling **F10** whichever option is chosen needs a cross-tenant
denial case with a same-tenant positive control, and the acceptance carries an **end-to-end** arm
that asserts criterion 4 itself: a founder-available route returns the bytes of an artifact a
distributed run produced.
