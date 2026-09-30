# Physical Repository Cleanup Plan

> **For agentic workers:** Use superpowers:subagent-driven-development only after the owner reviews the destructive scope. Checkboxes track completion.

**Goal:** Remove old-brand occurrences from the entire physical repository folder, not only the active tracked source.

**Architecture:** The tracked `main` source is already clean. Preserve and review user-created files before edits; classify runtime data and each worktree before retirement. Treat rewriting published Git history and renaming the checkout parent as separate, coordinated operations.

**Tech Stack:** Git, PowerShell, ripgrep, package manager, archive inspectors.

**Spec:** `docs/superpowers/specs/2026-09-30-aoa-clean-break-design.md`

## Global Constraints

- Do not remove an active worktree or process's checkout.
- Preserve pre-existing untracked user documents and pitch assets with external backups before editing. The owner has now authorized removal from documentation, including the presentation files under `docs/strategy/pitch`.
- Use the app's worktree archive tooling only for worktrees attached to this chat. Classify other registrations and plan their recovery individually; never shell-delete their directories.
- Git history reconstruction or remote replacement is irreversible for collaborators and requires a separate explicit decision.
- Do not claim physical zero based only on a text scan that skips archives or binary data.

## Review Focus

- A nested worktree may have uncommitted changes or a running task.
- Dependency reinstall can recreate the forbidden token from an external package or package metadata.
- A PPTX, ZIP, or other archive can contain text absent from a normal ripgrep scan.
- Git refs, reflogs, object packs, and worktree metadata can retain historical bytes after source cleanup.
- Renaming the checkout parent folder can invalidate absolute launch paths and registered worktrees.

## Verified inventory (2026-09-30)

- Tracked `main` content and paths: zero target-token matches.
- Nonignored untracked files at the first inventory: 499 total; 36 content matches (24 pitch-build intermediates and scripts, 12 authored product/research/strategy documents); no matching filenames. This is a dated snapshot, not a current total.
- A no-ignore documentation scan additionally found 26 ignored historical documents and two matching ignored filenames. Together with the 12 authored documents, 38 plain-text docs contained 345 occurrences. All 38 have now been edited with an external backup; the two filenames have been renamed. Ten matching PPTX files under `docs/strategy/pitch` have also been edited and package-validated. A final independent documentation scan is still required.
- At the first inventory, those 36 text files contained 247 target-token occurrences. Archive inspection found 27 matching PPTX/ZIP files with 132 embedded occurrences among 37 untracked archives checked across the repository. Ten of those archives were under `docs/strategy/pitch` and are now edited; archives outside `docs/` remain a separate cleanup class.
- Current documentation proof (2026-09-30): a hidden/no-ignore, case-insensitive scan finds zero matching content files and zero matching paths under `docs/`; inspection of all 15 DOCX/PPTX/XLSX/ZIP archives there finds zero embedded matches and no damaged ZIP members. The sole PNG in `docs/` was visually inspected and contains no old branding. Re-run after any further edits or builds.
- A partial no-ignore scan found 8,720 additional matching files outside `.claude/worktrees`, including 7,866 in nested `.worktrees`, about 735 under `server` runtime output, 19 under `data`, and smaller local cache/log groups. It excluded dependencies, build outputs, and archives, so it is not a whole-folder total.
- A later runtime audit found 29 matching files under `data` (including embedded PostgreSQL data/WAL), 26 under `.gstack`, matching run logs and test output, and many matches in `dist`/`node_modules`. The stale ignored old-name plugin directory contained only `dist` and `node_modules`, with no tracked source or app process reference; it was moved intact to `C:\Users\TK\.codex\backups\aoa-physical-2026-09-30`.
- The 328 actual files under `.aoa-pitch-build` were backed up to `C:\Users\TK\.codex\backups\aoa-pitch-build-2026-09-30`, then cleaned. Its 16 affected PPTX packages and delivery ZIP have zero matching embedded content; changed PPTX XML parses and the build scripts pass `node --check`. The directory's `node_modules` junction resolves to shared dependencies outside this repo and still exposes matching vendor files when followed. Its `@oai/artifact-tool` package is needed by the pitch build, so the junction remains until dependency replacement is planned.
- The ignored root `.env` had one matching comment, now updated after a private external backup. `.claude/settings.local.json` contains historical permission commands and absolute paths into the current parent directory; update those only together with the parent-path migration to avoid breaking live permissions.
- Twelve affected generated-output directories were backed up to `C:\Users\TK\.codex\backups\aoa-generated-2026-09-30`. A frozen install repaired a missing Hermes workspace link and `pnpm build` passed; matching generated files fell from 370 to 39. Automatic approval review rejected the recursive removal of stale outputs with only “blocked by policy,” so those 39 remain. Do not retry the same removal through another method.
- Registered Git worktrees: 223 paths exist; 22 have tracked changes. Thirty-one worktree paths contain the old name. Three checked-out branches have replatform-related names, but none is exactly `replatform`.
- Local Git at the latest inventory: `main` is seven commits ahead and twelve behind `origin/main`; 449 local branches, 457 remote-tracking refs, 406 local tags, seven stashes, and 10,589 commits reachable across refs. Exactly 140 tag names and one temporary ref name match the target token; four stashes have matching diff content. A subject-only search finds 308 matching commit subjects. Recheck these numbers before integration.
- Published GitHub `main` is protected against force pushes, and eleven pull requests are open. Public clones, forks, caches, and PR records cannot be guaranteed clean through a repository rewrite.
- The twelve remote-only commits change 258 paths; 35 overlap the 631-path cleanup. They add roughly 80 target-token lines, so a routine merge would reintroduce the term. Integrate remote changes against current AoA contracts with full tests and the zero-match guard.

## Execution boundaries

1. Reconcile user-created files with backed-up, reviewed edits. Include ignored documentation and archives; normal text search is insufficient. Scan `docs/` with no-ignore content and pathname searches, then inspect embedded XML in every PPTX/ZIP/DOCX/XLSX file. Keep build intermediates as a separate class.
2. Classify runtime logs/data by retention need and process ownership; remove or regenerate only confirmed disposable outputs. Preserve any diagnostic or user data outside the repository before removal.
3. Audit every worktree for tracked/untracked/ignored changes and running processes. Archive only confirmed idle worktrees attached to this chat using the Codex app tool; plan other worktrees individually with a recoverable Git procedure. Preserve active work and identify the user's intended replatform checkout before applying changes there.
4. Reconcile local and remote `main` before any history plan. Make a verified mirror backup and rehearse any history rewrite in an isolated mirror. Produce an exact branch/tag map and scan every rewritten ref. The remote rewrite needs an administrator policy window and explicit approval after the rehearsal; it changes commit identities for collaborators.
5. Rename the physical parent folder only after worktree registrations, launch configs, and external absolute paths have a tested migration path.
6. Re-scan tracked, untracked, ignored, binary/archive contents, every retained worktree, refs, and the parent path. Report each remaining class rather than claiming literal zero early.

---

### Task 1: Re-inventory after source cleanup

**Files:** Entire repository folder and parent path, read-only.

- [ ] Run a hidden, no-ignore, case-insensitive content and pathname scan for `p[a]per[[:space:]_-]*clip` after install/build.
- [ ] Inspect matching binary/archive formats and Git metadata/history separately.
- [ ] Classify every hit as active source, user-owned untracked, generated disposable, dependency, nested worktree, Git metadata/history, or parent path.
- [ ] Record counts and ownership; do not mutate any class yet.

### Task 2: Disposable and user-owned files

**Files:** Build outputs, logs, local data, dependencies, untracked documents and pitch assets.

- [ ] Identify which generated outputs are disposable and which processes use them.
- [x] Preserve and move the stale ignored plugin build/dependency directory outside the checkout after a process and tracked-source check.
- [x] Back up and clean the actual `.aoa-pitch-build` files, including its editable scripts, PPTX decks, and delivery ZIP. Preserve the shared dependency junction until its replacement is tested.
- [ ] Clean/rebuild disposable outputs through their owning build or package workflow, then rescan.
- [x] Repair workspace links with frozen install and rebuild; record the 39 residual generated matches and the policy rejection of their removal.
- [x] Back up and edit the authorized documentation classes: authored and ignored Markdown, matching documentation filenames, and PPTX files under `docs/strategy/pitch`. External backup: `C:\Users\TK\.codex\backups\aoa-docs-2026-09-30`.
- [ ] Review the edited documentation and verify no-ignore content, filename, and embedded-archive zero matches. Classify all remaining user-owned assets outside `docs/` before edits.
- [ ] Inspect archives after any edit or rebuild and rescan binary formats.

### Task 3: Nested worktrees

**Files:** Registered and unregistered nested worktrees; baseline is 223 registered worktrees.

- [ ] Inventory each worktree's owner, branch, dirty state, running process, and recoverable content.
- [ ] Rebase active worktrees onto clean source or keep them active until their owners finish; do not bulk-delete.
- [ ] Archive eligible managed worktrees attached to this chat with the app worktree tool, preserving snapshots; handle every other registration through an explicitly reviewed, recoverable Git procedure.
- [ ] Rescan nested directories and metadata.

### Task 4: Git history and folder path decision

**Files:** `.git` metadata/history, remote repository, checkout parent directory, absolute-path configuration.

- [ ] Ask the owner to choose whether literal zero includes Git commit history and the parent directory name.
- [ ] If yes, design a coordinated history rewrite with remote/collaborator migration, backup, and rollback plan; review it before execution. A temporary mirror is permitted for rehearsal, but no new permanent repository is planned.
- [ ] Recreate or rewrite metadata only after that review, then verify refs, objects, logs, and worktree registration.
- [ ] Rename the parent folder only with a coordinated update to launch configs, worktree registrations, and external paths.

### Task 5: Final proof

**Files:** Entire physical folder and parent path.

- [ ] Repeat text, pathname, archive/binary, and Git-history scans after all builds and cleanup.
- [ ] Include ignored documentation, retained worktrees, dependency/build output, Git refs and metadata, and the checkout parent path in the final scope report.
- [ ] Require zero matches in the agreed literal scope; list any unresolved class as an open gate, never as complete.
