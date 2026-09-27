# M1a Historical QA Disposition Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved plan task-by-task.

**Goal:** Preserve PR610/615 history and append formal FAIL corrections without certifying any current candidate.

**Architecture:** Add only documentation to an isolated branch at remote docs/replatform-program `0510d482798e62672a8f6085915231c5f8578e87`. Preserve original records and all 85 baseline immutable records (69 QA and 16 handoffs); use higher immutable attempts for corrections.

**Tech Stack:** Git object identity, Markdown, existing evidence guards.

**Spec:** User-authorized bounded historical disposition of PR610/615, 2026-09-27.

## Global Constraints

- No edits in the dirty main checkout or parent PR631 worktree.
- Restore ten original paths byte-identically from `af3ca5ceb49f7bcb7d7012ab8f100d5e38894f1d`; eight shared paths must equal `f6e5dfc120f2749e6cbcad457e7eec6b9ea7a9c9`.
- No raw logs, provider/build/H-08 approvals invented, local-copy retention proof, or cleanup inferred from job success.
- Current 17-required/9-pending approval does not retroactively amend historical scope.
- No Hubble, AWS, campaigns, secrets, IAM, signing, push, PR, merge, external closure, or PR631 changes.

## Review Focus

Exact original blobs; all final successors and inline findings; candidate-time normative scope; global ordinal collisions and conditional chains; retention/identity/cleanup claims.

### Task 1: Preservation and audit

**Files:** Ten original QA paths from PR615; new historical inventory under `docs/replatform/milestones/M1a/`.

- [x] Restore absent paths mechanically, verify exact Git blob identities and baseline record count.
- [x] Audit all ten records, PR inline comments, candidate trees and approved scope; inspect structured artifact metadata and the available 446d journey JSON only.
- [x] Inventory active remote attempts and document conditional chain/allocation decisions before committing corrections.

### Task 2: Corrections and handoff

**Files:** New D1 attempts >=24 and mechanism attempts >=30, allocated above remote maxima; historical disposition inventory.

- [x] Append corrections for f8 D1 retention gaps, 446d D1 invalid metadata/no exact run, and both mechanism final originals; preserve formal FAIL and non-adoption.
- [x] Check documentation scope, original/baseline blob equality, valid QA metadata, supersedes links, normative IDs and existing immutability guard at baseline; repeat the guard on the final commit.
- [x] Complete separate author self-review and stage the local docs plan and records for commit. Parent independently reviews and publishes.

## Execution Ledger

Approved inline execution; no subagent capability is exposed. Independent read-only audits run in parallel. Runtime typecheck/tests/build are not campaign evidence and are not run for this bounded docs-only disposition; report that limitation explicitly.

Task 1: complete. Ten restored raw Git blobs match PR615; eight shared blobs are checked against PR610 at handoff. Baseline count corrected to the guard's 69 QA + 16 handoffs = 85 records.

Ruling: corrections branch from the candidate-specific historical predecessors, with globally higher allocations, rather than superseding current d479 D1 23. This preserves both histories; cost if misread is accidental current-candidate adoption, explicitly prohibited in every new record.

Ruling: the candidate-time DEP-018 two-tier amendment prevents a blanket zero-pending requirement; broader historical mechanism allocation remains unresolved without a candidate-time reallocation approval. Formal FAIL is independently established by identity/retention gaps. Cost if historical approval later appears is a new higher scope clarification, not a rewritten original.

Final review: self-review (no subagent tool). Duplicate EVID-02 table entries removed before first commit. No passing campaign certification attempted. Parent independent review remains outstanding.

Task 2 precommit verification: PASS, ten raw originals and eight shared blobs, all 85 baseline immutable blobs, 16 docs-only additions, four valid FAIL correction headers with unique normative IDs and backward Supersedes links. Each source original has exactly one introducing path commit and its first-commit blob is unchanged. Whitespace check passes.

Final remote audit: 441 active heads; D1 maximum 23, mechanism maximum 29; integration still exactly 0510d482798e62672a8f6085915231c5f8578e87. Allocations 24/25 and 30/31 remain conditional until the parent's publication-time audit. Local commit follows these checks; final committed-tree guard and clean status are reported in the handoff.
