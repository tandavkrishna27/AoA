# Clean Main for Fresh Repository Export Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Checkboxes track completion.

**Goal:** Make the current `main` source tree functionally sound and free of all former-brand content and pathnames. A fresh repository export is optional later work, not part of the current cleanup.

**Architecture:** Implement and verify the five area plans on an isolated branch, then integrate them into `main` and prove zero matches there. A later fresh repository may be initialized from verified exported files instead of cloning old history. Pre-existing untracked user files need separate review if that later export occurs.

**Tech Stack:** TypeScript, React, Express, Drizzle, pnpm, Docker, Git.

**Spec:** `docs/superpowers/specs/2026-09-30-aoa-clean-break-design.md`

## Global Constraints

- Current `main` has 592 matching tracked files and 11 matching tracked paths among approximately 5,750 tracked files at the planning baseline; refresh counts before implementation.
- Approximately 31,530 matching files in nested worktrees are separate copies, not additional files in the active `main` source.
- The new repository export must contain zero joined or separator-varied old-brand matches in content and paths, including lockfile, docs, tests, and tracked hidden files.
- Preserve pre-existing untracked files until individually selected for the new repository; a user-owned file is never silently discarded or bulk-rewritten.
- No old-user compatibility is required, but current AoA capabilities, including Hermes execution, must work.
- Do not commit directly on `main` during implementation. Use an isolated branch/worktree and integrate only after review.

## Review Focus

- Historical Drizzle migrations/snapshots must produce a valid empty database after the sequence-preserving scrub.
- Plugin scaffold output and first-party examples must load under the new manifest and bridge.
- Hermes must execute authenticated tasks through the new AoA-owned adapter.
- A tracked binary/archive can hide old text from ordinary grep; inspect embedded text where relevant.
- A fresh export must include required tracked files and exclude old `.git`, worktrees, ignored outputs, and dependencies.

---

### Task 1: Establish the exact `main` inventory

**Files:** Active tracked tree and index, read-only.

- [ ] Record `git branch --show-current`, `git status --short`, and all tracked content/path matches with `p[a]per[[:space:]_-]*clip` (case insensitive).
- [ ] Group matching files by package, docs, server, UI, CLI, deployment, tests, migrations, and hidden configuration.
- [ ] Identify tracked binary/archive files and inspect embedded text; list any matches not visible to text grep.
- [ ] Freeze canonical replacement names and file ownership before agents edit.

### Task 2: Build the clean source on an isolated branch

**Files:** See Hermes, plugins, core, UI/deployment, and docs/policy area plans.

- [ ] Complete Hermes replacement and focused tests.
- [ ] Complete plugin contract/scaffold replacement and focused tests.
- [ ] Complete core contract, CLI, adapter, and Drizzle migration and history scrub; prove empty-database replay.
- [ ] Complete UI/deployment and operational scripts; run focused tests and Docker/Compose checks where available.
- [ ] Update current and historical docs, links, filenames, and CI zero-token policy.
- [ ] Regenerate `pnpm-lock.yaml` once after all manifest edits; confirm frozen install.

### Task 3: Verify and integrate into `main`

**Files:** Entire tracked source tree.

- [ ] Review each area diff and cross-package interface; ensure no concurrent agent commits to shared files.
- [ ] Run `pnpm -r typecheck`, `pnpm test:run`, and `pnpm build`.
- [ ] Run focused Hermes, plugin, import/export, workspace, migration replay, and Docker/Compose checks.
- [ ] Require zero tracked-content and tracked-path matches, plus archive/binary-aware checks.
- [ ] Integrate the verified branch into `main` and repeat the zero-match and required checks at the final `main` commit.

### Optional later Task 4: Produce and audit a fresh export

**Files:** A new export directory outside the old checkout; no old `.git` directory is copied.

- [ ] When the owner requests a new repository, export the verified `main` tracked tree (for example, from the final commit's archive), rather than copying the old checkout or cloning its history.
- [ ] Review each pre-existing untracked document or asset proposed for inclusion; clean and add it explicitly if selected.
- [ ] Scan every exported filename and text/binary/archive payload for the old-brand pattern.
- [ ] Run frozen install, `pnpm -r typecheck`, `pnpm test:run`, and `pnpm build` in the exported tree; rescan generated output and dependencies that will be shipped or committed.
- [ ] Initialize fresh Git history only after export verification; record the new repository source commit and test evidence.

### Task 5: Keep old workspace separate

**Files:** Old checkout, nested worktrees, logs, dependencies, and metadata.

- [ ] Leave old worktrees and Git history outside the new repository export.
- [ ] If the owner later wants the old physical folder itself clean, use the separate physical-folder plan; do not make that a prerequisite for the fresh repository.
