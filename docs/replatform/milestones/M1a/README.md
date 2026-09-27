# M1a — working documents (not records)

This folder holds **mutable working documents** for milestone `M1a`. It also holds `M1a`'s
immutable records, once they exist, in `qa/` and `handoffs/`. Those two subfolders follow
[`../README.md`](../README.md) and `EVID-04` (`../../test-gates.md`). **Nothing outside `qa/` and
`handoffs/` is an evidence record.** A file outside them grants nothing and can be corrected in place.

| Path | What | Entry bullet it serves (`../../epic-regrooming/scope-triage.md` → *Entry criteria*) |
|---|---|---|
| [`2026-09-27-e0-e2-delta-review-d479709ed894.md`](./2026-09-27-e0-e2-delta-review-d479709ed894.md) | Current E0–E2 dependency/delta review for candidate `d479709ed8940fe69ef28539daadb90b9b29310b`; earlier reviews remain historical | *"E0–E2 historical completion evidence has passed a current dependency/delta review, including superseding records for any immutable-record breach"* |
| [`reachability/d479709ed894/`](./reachability/d479709ed894/) | Current candidate-specific E3–E6 reachability ledgers and complete M1a matrix inventory for `d479709ed8940fe69ef28539daadb90b9b29310b`; earlier candidate directories remain historical | *"E3–E6 have candidate-specific ledgers showing which mechanisms are production-reachable rather than merely present and which clauses are certified only by `M1-D1-SPINE`"* |

## Why these are not under `qa/` or `handoffs/`

- **Neither document is a gate run or a gate decision.** A QA record carries a `Result` and a
  handoff carries a `Decision`. A delta review and a ledger carry neither. `qa-handoff-recovery.md`
  and `../README.md` name no path for either document.
- **Both must be re-measured.** The delta review is measured against a moving tip, and the ledgers
  are skeletons that are filled when the candidate is frozen. An immutable record cannot be filled in
  later. Each edit would have to be a new attempt, and no template defines an attempt of this kind.
- **Neither belongs to one epic.** The delta review spans E0–E2, and the ledgers exist to feed the
  `M1a` entry check. So they live in the milestone folder, beside the records they feed.

★ **When the `M1a` candidate is frozen, the QA owner cites these documents at that candidate's
SHA.** The candidate-freeze record pins their blob SHAs, so the version that was relied on is fixed
by the record that relies on it, not by making the working document immutable.

★ **`M1b` freezes a different candidate** (`../../epic-regrooming/qa-handoff-recovery.md` steps 7–9).
Its ledgers are **new copies** under `milestones/M1b/`, measured on the `M1b` candidate. They are not
these files, updated.
