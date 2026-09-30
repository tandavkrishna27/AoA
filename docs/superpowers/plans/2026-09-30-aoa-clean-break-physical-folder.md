# Physical Repository Cleanup Plan

> **For agentic workers:** Use superpowers:subagent-driven-development only after the owner reviews the destructive scope. Checkboxes track completion.

**Goal:** Remove old-brand occurrences from the entire physical repository folder, not only the active tracked source.

**Architecture:** The tracked `main` source is already clean. Preserve and review user-created files before edits; classify runtime data and each worktree before retirement. Treat rewriting published Git history and renaming the checkout parent as separate, coordinated operations.

**Tech Stack:** Git, PowerShell, ripgrep, package manager, archive inspectors.

**Spec:** `docs/superpowers/specs/2026-09-30-aoa-clean-break-design.md`

## Global Constraints

- Do not remove an active worktree or process's checkout.
- Preserve pre-existing untracked user documents and pitch assets unless the owner authorizes editing or relocation of those exact classes.
- Use the app's worktree archive tooling for managed worktrees; never shell-delete their directories.
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
- Nonignored untracked files: 499 total; 36 content matches (24 pitch-build intermediates and scripts, 12 authored product/research/strategy documents); no matching filenames.
- Those 36 text files contain 247 target-token occurrences. Archive inspection found 27 additional matching PPTX/ZIP files with 132 embedded occurrences among 37 untracked archives checked; these need deliberate document edits or regeneration, not a plain text replace.
- A partial no-ignore scan found 8,720 additional matching files outside `.claude/worktrees`, including 7,866 in nested `.worktrees`, about 735 under `server` runtime output, 19 under `data`, and smaller local cache/log groups. It excluded dependencies, build outputs, and archives, so it is not a whole-folder total.
- Registered Git worktrees: 223 paths exist; 22 have tracked changes. Three checked-out branches have replatform-related names, but none is exactly `replatform`.
- Local Git: `main` is four commits ahead and twelve behind `origin/main`; 449 local branches, 457 remote-tracking refs, 406 local tags, seven stashes, and roughly 10,586 commits reachable across refs. About 140 tag names and 1,428 commit subjects contain the target token.
- Published GitHub `main` is protected against force pushes, and eleven pull requests are open. Public clones, forks, caches, and PR records cannot be guaranteed clean through a repository rewrite.
- The twelve remote-only commits change 258 paths; 35 overlap the 631-path cleanup. They add roughly 80 target-token lines, so a routine merge would reintroduce the term. Integrate remote changes against current AoA contracts with full tests and the zero-match guard.

## Execution boundaries

1. Reconcile the 36 user-created files with backed-up, reviewed edits. Inspect PPTX and other archives separately; normal text search is insufficient.
2. Classify runtime logs/data by retention need and process ownership; remove or regenerate only confirmed disposable outputs. Preserve any diagnostic or user data outside the repository before removal.
3. Audit every worktree for tracked/untracked/ignored changes and running processes. Archive only confirmed idle managed worktrees using the Codex app tool. Preserve active work and identify the user's intended replatform checkout before applying changes there.
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
- [ ] Clean/rebuild disposable outputs through their owning build or package workflow, then rescan.
- [ ] Present exact user-owned untracked file classes for approval to edit, relocate, or preserve as an explicit exception; retain backups if edited.
- [ ] Inspect archives after any edit or rebuild and rescan binary formats.

### Task 3: Nested worktrees

**Files:** Registered and unregistered nested worktrees; baseline is 224 registered worktrees.

- [ ] Inventory each worktree's owner, branch, dirty state, running process, and recoverable content.
- [ ] Rebase active worktrees onto clean source or keep them active until their owners finish; do not bulk-delete.
- [ ] Archive eligible managed worktrees with the app worktree tool, preserving snapshots; handle non-managed worktrees through an explicitly reviewed Git procedure.
- [ ] Rescan nested directories and metadata.

### Task 4: Git history and folder path decision

**Files:** `.git` metadata/history, remote repository, checkout parent directory, absolute-path configuration.

- [ ] Ask the owner to choose whether literal zero includes Git commit history and the parent directory name.
- [ ] If yes, design a fresh repository or coordinated history rewrite with remote/collaborator migration, backup, and rollback plan; review it before execution.
- [ ] Recreate or rewrite metadata only after that review, then verify refs, objects, logs, and worktree registration.
- [ ] Rename the parent folder only with a coordinated update to launch configs, worktree registrations, and external paths.

### Task 5: Final proof

**Files:** Entire physical folder and parent path.

- [ ] Repeat text, pathname, archive/binary, and Git-history scans after all builds and cleanup.
- [ ] Require zero matches in the agreed literal scope; list any unresolved class as an open gate, never as complete.
