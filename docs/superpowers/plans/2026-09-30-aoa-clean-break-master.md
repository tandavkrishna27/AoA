# AoA Clean Break Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a working AoA application with zero old-brand text or pathnames in the active tracked `main` source, with a fresh repository export available as optional later work.

**Architecture:** Change public/internal contracts by owning area, replace the external Hermes adapter, update all consumers and documentation, and close with a strict zero-match CI gate. A coordinator owns shared integration and full verification.

**Tech Stack:** TypeScript, React, Express, Drizzle, pnpm, Vitest, Docker, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-30-aoa-clean-break-design.md`

## Execution status (2026-09-30)

Implementation and review are complete and were fast-forwarded from the
`codex/aoa-clean-main` worktree into `main`. A scan of tracked paths and file bytes reports zero target-token
matches. Frozen lockfile install, repository typecheck, build, and the full
test suite pass (17,767 passed; 553 configured skips). A fresh embedded
PostgreSQL replay through migration 0204 also passes. The original checkout's
unrelated untracked files are preserved. Historical migration checksums changed, so existing databases need
a controlled reset or journal remap. This project has no existing product users.
The original checkout also contains 499 unrelated untracked files. A separate
scan found target-token content in 36 of them, primarily pitch build outputs
and research documents. They were preserved and are outside the tracked `main`
branch; the optional physical-folder plan covers that separate cleanup.

## Global Constraints

- No old-brand token in tracked content or paths, including docs, tests, lockfile, and hidden tracked files.
- Preserve current AoA capabilities; no old-user migration support is required.
- Keep the existing dirty/untracked user work intact until a separately reviewed physical-folder action names it.
- Manifest and regenerated lockfile changes travel together.
- Run all verification commands required by `AGENTS.md` before handoff.
- Begin implementation in a dedicated branch/worktree; do not commit on `main`.

## Review Focus

- Cross-package names must match exactly at each boundary.
- Hermes task execution must authenticate API calls.
- Plugin examples/scaffold must load through the renamed bridge and manifest.
- Docker paths and database defaults must agree with bootstrap and health checks.
- Historical docs must not contradict current implementation.

---

### Task 1: Freeze contract map

**Files:** This plan and its five area plans.

- [ ] Confirm canonical field/global/package/path names for every area before parallel implementation.
- [ ] Assign one agent each to Hermes, plugin platform, core contracts, UI/deployment, and docs/policy in waves of at most three agents; shared files have one owner.
- [ ] Establish a dedicated branch/worktree and preserve the existing dirty checkout before implementation.

### Task 2: Implement by area

**Files:** See area plans: `*-hermes.md`, `*-plugins.md`, `*-core.md`, `*-ui-infra.md`, `*-docs-policy.md`, and `*-physical-folder.md` in this directory.

- [ ] Execute Hermes and plugin foundational contracts, with focused tests and review.
- [ ] Execute core contract changes, with focused tests and review.
- [ ] Execute UI/deployment changes after consuming contract names, with focused tests and review.
- [ ] Execute documentation/policy changes after contract names are final, with link and zero-match review.
- [ ] Integrate the reviewed cleanup into `main`. The clean-main-export and physical-folder plans are optional later work.

### Task 3: Integrate and hand off

**Files:** Entire active tracked tree.

- [ ] Inspect every agent diff and resolve cross-area mismatches.
- [ ] Regenerate the lockfile once after all manifest edits; run frozen install and include manifests and lockfile in the same PR.
- [ ] Run frozen install, `pnpm -r typecheck`, `pnpm test:run`, and `pnpm build`.
- [ ] Run content and pathname zero-match checks from the investigation doc.
- [ ] Check existing dirty/untracked work is preserved. Review user-owned files separately if a fresh export is later requested.
- [ ] Review final diff and report changes, test evidence, and any remaining limitation.
