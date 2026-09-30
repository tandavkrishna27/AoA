# Physical Repository Cleanup Plan

> **For agentic workers:** Use superpowers:subagent-driven-development only after the owner reviews the destructive scope. Checkboxes track completion.

**Goal:** Remove old-brand occurrences from the entire physical repository folder, not only the active tracked source.

**Architecture:** Complete and verify the source implementation first. Inventory ownership and active use of every remaining copy. Clean disposable outputs, reconcile user-created files and worktrees, then reconstruct Git metadata only if the owner explicitly chooses literal history removal.

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
