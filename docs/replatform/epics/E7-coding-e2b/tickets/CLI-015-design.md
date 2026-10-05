# CLI-015 — Unit F link 6, the judge: a verifier that counts the right things

**Status:** implemented locally; integration testing pending. · **Epic:** E7 · **Was:** `CLI-008-F6` (see `program-design.md`, the
link-scoped successor mapping) · **Filed:** 2026-09-21 (M0 unit 4, founder decisions D1 + D5)
**Depends on:** `CLI-011` · **Milestone:** `M1b`
**Owns:** [`E7-F016`](../findings.md#e7-f016)

---

## Current implementation — October 6

The current implementation plan extends this work to the scanner repairs while
preserving their CLI-008 finding ownership. Lifecycle and capability evidence
remain attempt-scoped. Secret scanning now includes sibling attempts' events and
refuses explicitly when row, text or aggregate limits prevent a complete scan.
The operator text describes the composed output pipeline and distinguishes
`ok` from `capabilityProven`; `--require-capability` enforces produced output.
Named empty/redacted/template values are excluded without suppressing arbitrary
credential-shaped strings. Generic `sk-` text remains ambiguous, so E7-F033 is
not claimed fully closed. Focused PostgreSQL and verifier tests passed locally.

The sections below retain the historical scope discussion; its claim that the
producer is unbuilt and its separate ruling prerequisite are superseded.

## Why this ticket exists under this id

Identical to `CLI-011`'s: `CLI-008-F6` is unrepresentable to the ownership guard, and a
`CLI-008-F6-result.md` would resolve to `CLI-008` and orphan its findings. Numeric id, unchanged
scope.

## Scope

Clause 6 of the E7-1 distributed-run verifier. Its two arms are `countProducedOutputs`
(`server/src/services/e7-distributed-run-verifier-store.ts:124`) and they answer *"did anything the
agent produced reach AoA"* — which is the `capabilityProven` dimension, computed separately from
`ok`.

## The finding it owns

**E7-F016** — *clause 6's operator-facing text misdescribes its own subject: four blamed links
(three of which flip neither counter), and a verdict named for more than it proves.* This is clause
6's own text about clause 6's own subject, so it belongs here and not on the parent.

★★★ **The obvious repair is REFUTED and must not be re-attempted.** Folding a clause-6 failure into
`ok` would make E7-1 **permanently red** — both counts are structurally 0 in every checked-in
configuration — and would retroactively invalidate the D1 40/40 evidence, which is honest evidence
**of the mechanism** and stays true. `scripts/lib/gate-clause-wiring.mjs` states the consequence in
its own header: *"a guard that forbids honest debt gets deleted."* So `ok` keeps meaning "the
distributed journey was corroborated" and `capabilityProven` stays a second, independent dimension.

★ **What is NOT in scope, and this boundary is load-bearing.** Clause **4** is the secret scanner
(`:122`, `:305`), not the counter. `E7-F023`, `E7-F032` and `E7-F033` are all clause-4 findings and
were deliberately **left on `CLI-008`** in M0 unit 4 rather than swept in here, because a successor
that quietly absorbs findings about a different clause is a false claim of ownership — the exact
thing `check-finding-ownership` exists to stop.

## Acceptance

The verifier distinguishes a run that produced something from one that did not, and its
operator-facing text names only what it actually reads. Blocked on `CLI-011`'s ruling: what clause 6
should count is a consequence of how output leaves the sandbox.

## Test

The existing four-mutation corpus extended to the corrected clause, each mutation reddening a named
row — including the mutation that proves `ok` does NOT flip on a corroborated journey, which is the
guard against the rejected design and works only because that pin was written first.
