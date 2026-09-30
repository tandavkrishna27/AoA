# AoA Clean Break: Investigation

## Scope and baseline

The active checkout is on `main`. Before this investigation, `.claude/launch.json` was modified and several pitch, strategy, product, research, and review files were untracked. This investigation made no changes to those files.

The target token is the former upstream brand, represented here as `p[a]perclip` so this record can remain in the final clean repository. Search is case insensitive and includes joined, spaced, hyphenated, and underscored spellings, with any number of separators. The user clarified the delivery strategy: **clean the current `main` source**; a fresh repository export is optional later work. Git history, the parent folder, dependencies, logs, and nested worktrees are outside this tracked-source check. Cleaning the old physical folder itself is a separate optional goal.

Baseline: `git grep -I -i -n -E 'p[a]per[ _-]?clip'` found approximately 3,295 matching lines across 591 tracked files, excluding the lockfile. A wider scan found 592 matching tracked files and eleven matching tracked path entries. A case-insensitive, hidden, no-ignore text scan of the full folder found **34,401 matching files**: 31,530 nested-worktree files, 1,066 dependency files, 1,213 other ignored/untracked/generated files, and 592 active tracked files. A separate `.git` text scan found 161 matching metadata files; compressed Git objects also preserve historical commits. The checkout's parent path itself contains the old brand. Counts must be refreshed at execution start because the checkout can change.

## Findings by implementation area

| Area | Active uses | Failure if renamed alone | Required action |
| --- | --- | --- | --- |
| UI | Company import copy, persisted browser keys, project workspace sentinel, skill source badge, plugin bridge, attachment icon imports, service worker cache | Lost preferences, incorrect workspace resolution, unloaded plugins | Rename producer and consumer together; remove old browser migration path under the no-users clean break; use an alternate attachment icon export; rebuild assets |
| Server and shared | Auth issuer/audience/header, agent execution context, wake context, skill sync, plugin types, feedback versions, synthetic actor, import format | Failed callbacks, missing context, bad deserialization | Define AoA-only contracts, update all readers/writers, fixtures, and tests; regenerate DB migrations only if schema changes |
| Adapters | OpenClaw config and wire fields, remote workspace paths, env values, external Hermes contract | Failed agent execution or callback | Rename both sides of internal contracts; replace Hermes dependency with an AoA-owned adapter |
| Plugin platform | Manifest key, global bridge, SDK types, npm package/scaffold name, development server routes/bin, installed plugin key mapping | Plugin discovery and runtime failure | Rename loader, SDK, scaffold, example manifests, routes and tests as one contract change |
| CLI and deployment | CLI alias, home directory, container path, Compose database defaults, backup names, shell scripts, lockfile | Wrong data location or startup failure | Use AoA-only defaults across all scripts and docs; remove dependency and regenerate lockfile with manifest edits |
| Documentation and policy | Architecture baseline, locked compatibility decision, migration/upgrade guides, archived plans and comparisons, brand guard | Contradictory instructions and stale links | Explicitly supersede the old decision, rewrite historical wording without the token, rename token-bearing paths, update links, enforce zero-match in CI |
| Database migration history | 144 historical SQL and Drizzle snapshot files, including feedback defaults and sentinels | Editing snapshots/SQL casually can break migration replay, checksums, and Drizzle generation | Preserve the migration sequence, scrub obsolete data text without hand-authored schema DDL, generate new schema changes with Drizzle, and prove fresh-database replay; existing journals require reset or remap |
| Operational edges | Changeset config, evaluation fixtures, end-to-end DB URLs, release workflow/URLs, onboarding and smoke scripts, modified launch config | Broken release, evaluation, or launch flows | Assign explicit owner and focused checks for each edge |
| Physical-folder copies | 224 registered worktrees, dependencies, outputs, local data/logs, Git metadata/history, parent directory | Source can pass while the word remains in tens of thousands of files | Inventory ownership and active use; clean or reconstruct only through a separate, reviewed procedure |

## Special blockers

1. The external Hermes adapter package embeds the old name in its package name and protocol. Zero traces requires replacing the dependency, not aliasing it.
2. The current compatibility decision and wire reference explicitly require old names. The clean-break decision must supersede that guidance before code changes.
3. Some old-name values are stored keys or path sentinels. There are no users, so migration aliases are unnecessary, but every in-repository producer/consumer and test must change atomically.
4. First-party plugin examples and the SDK expose the old manifest key and types. A partial rename makes plugins silently fail.
5. The lockfile gate requires a manifest change in the same PR whenever the lockfile changes.
6. The current checkout is `main`, has pre-existing changes, and has 224 registered worktrees. Implementation needs a dedicated branch/worktree; no agent should commit concurrently in the shared checkout.
7. A literal zero-occurrence old physical folder would require decisions about deleting/rebuilding ignored outputs, modifying pre-existing untracked files, retiring registered worktrees, and rewriting or recreating Git history. The chosen fresh-export path avoids bringing those stores into the new repository. Any untracked file selected for export still needs review and cleanup.

## Acceptance evidence

- Source gate: a tracked-content and tracked-path scan for `p[a]per[[:space:]_-]*clip` returns no matches, including lockfile text. Scan binary assets separately; `git grep -I` alone is insufficient.
- Export gate: the fresh export has zero matching contents and pathnames, including selected untracked files and embedded archive/binary text. The export contains no old `.git` directory or nested worktrees. After install/build, rescan shipped or committed outputs. The old folder's optional physical gate remains open until its separate plan is executed.
- The repository's brand policy rejects both content and pathname regressions.
- `pnpm -r typecheck`, `pnpm test:run`, and `pnpm build` pass.
- Hermes execution, plugin loading, project workspace resolution, company import/export, and Docker/Compose configuration have focused tests.
- A separate report identifies matches left in the old physical folder; they do not enter the new repository export. Do not alter pre-existing user files or worktrees without selecting them for export or the separate cleanup decision.
