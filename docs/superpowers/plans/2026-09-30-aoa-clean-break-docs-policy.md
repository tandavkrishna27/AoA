# Documentation and Policy Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task by task. Checkboxes track completion.

**Goal:** Make documentation, filenames, and CI policy agree with the AoA-only implementation and enforce zero old-brand traces in active source; the physical-folder plan handles other stores.

**Architecture:** Supersede historical retention guidance explicitly, update current operational docs to exact new contracts, reword archived records without changing their causal history, rename old-token paths and links, and add a strict tracked-tree CI check.

**Tech Stack:** Markdown, Git, GitHub Actions, repository search utilities.

**Spec:** `docs/superpowers/specs/2026-09-30-aoa-clean-break-design.md`

## Global Constraints

- This investigation, spec, and plans remain in the final repo and therefore use neutral terms for the old brand.
- Do not delete unrelated historical records or alter pre-existing untracked files.
- Keep current architecture docs authoritative and distinguish plans from shipped behavior.
- The CI check covers tracked contents and paths, including lockfile and hidden files. Physical-folder scans run separately because CI does not own local worktrees/history.

## Review Focus

- A renamed doc path must have every navigation/link reference updated.
- Historical decision #92 must be explicitly superseded rather than silently rewritten as if it never existed.
- Current setup commands must agree with manifests, Docker, and the CLI.
- CI must detect both case variants and any run of spaces, hyphens, or underscores between words.
- The CI check itself must not contain a contiguous forbidden token.

---

### Task 1: Current reference docs and architecture decision

**Files:** Modify `CLAUDE.md`, `docs/architecture/{decisions,wire-compat}.md`, deployment/API/adapter/start docs, skills, and affected navigation metadata.

**Interfaces:** Document exact contracts delivered by the other plans.

- [ ] Add an explicit supersession of decision #92 and replace obsolete retention instructions.
- [ ] Update current examples, commands, paths, and names after implementation interfaces are fixed.
- [ ] Check links and source agreement; commit docs.

### Task 2: Historical docs and token-bearing paths

**Files:** Reword matching files under `docs/archive/`, `docs/aoa/`, `docs/strategy/`, changelogs, READMEs, release notes, and `.claude/skills/`; rename token-bearing tracked paths and update links.

**Interfaces:** No runtime changes. Preserve date, decision ID, and historical meaning.

- [ ] Inventory matching tracked docs/paths at execution time.
- [ ] Reword old-brand mentions as “upstream project” or specific technical descriptions; remove obsolete comparison docs only if their meaning cannot be preserved.
- [ ] Verify no broken relative links or doc navigation entries; commit docs/path changes.

### Task 3: Repository-wide regression guard and final audit

**Files:** Modify `.github/workflows/pr.yml`, existing brand audit scripts, root policy fixtures/tests, and any matching tracked file left by the earlier tasks.

**Interfaces:** Content regex `p[a]per[[:space:]_-]*clip` (case insensitive) and equivalent path scan; fail on any tracked match.

- [ ] Add a failing fixture/probe that proves the guard detects content and filenames.
- [ ] Replace allowlists with the strict zero-token guard; rename the existing audit script.
- [ ] Run the guard and resolve every tracked content/path hit.
- [ ] Run `pnpm -r typecheck`, `pnpm test:run`, and `pnpm build`; report exact results.
- [ ] Check `git status` against the baseline; execute the separate physical-folder plan for untracked/ignored/history matches.
