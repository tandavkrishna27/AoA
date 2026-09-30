# AoA Clean Break Design

## Intent

Remove the former upstream brand from the active `main` source while retaining current AoA product capabilities. There are no existing product users or installations to migrate. Hermes support remains, implemented through an AoA-owned adapter. A fresh repository export may happen later but is not part of the current cleanup. Cleaning the old physical folder remains a separate optional project.

## Contract strategy

Use AoA-only names for runtime environment variables, request headers, JSON fields, browser storage, plugin manifest and bridge interfaces, CLI names, import/export formats, workspace sentinels, feedback versions, directories, Docker paths, database defaults, and public SDK types. Remove old-name aliases and migration readers. Update producers, consumers, tests, examples, and documentation in a single release. Do not replace strings blindly: type names, persisted values, and file paths must be traced to all call sites.

## Hermes integration

Create `packages/adapters/hermes-local` using existing adapter utility helpers. Preserve adapter type `hermes_local`, CLI command/configuration, execution results, session resume, environment checks, and model list. Use AoA environment values and an authenticated task prompt. Register the new package in the server adapter registry, remove the external dependency from the server manifest, and regenerate the lockfile. Match the previous adapter's local execution target behavior; expanding remote execution is outside this rebrand.

## Work units and ownership

1. **Hermes package:** new package and executor tests; server registry and dependency switch.
2. **Plugin platform:** shared types, SDK, server loader/dispatcher, UI bridge, scaffolder, examples, package metadata, and focused tests.
3. **Core contracts:** server, CLI, adapters other than Hermes, DB/shared fields, config, auth, feedback, imports, workspace and skill contexts, and tests.
4. **UI and deployment:** browser state, product copy, icons, service worker, Docker, Compose, scripts, and focused tests. Cross-area interfaces are finalized before parallel edits.
5. **Docs and policy:** architecture decision supersession, current docs, historical docs, pathname/link updates, and a strict CI guard. This unit begins after contract names are fixed.

Agents edit disjoint file sets where possible. Shared files such as the registry and CI policy have one owner each. Area agents edit their own manifests; the coordinator alone regenerates and commits the lockfile after all manifest changes. At most three subagents run concurrently with the coordinator. Work begins on a dedicated branch/worktree, not `main`. The coordinator integrates, reviews, runs the full suite, and performs both source and physical-folder scans.

## Failure handling

Keep each work unit independently reviewable. If a proposed rename removes functionality, restore the capability under an AoA name rather than reintroducing the legacy token. If a test fixture depends on a historical value, rewrite the fixture and its expected behavior to the new contract. Historical Drizzle migration and snapshot changes require a sequence-preserving scrub with Drizzle-generated schema changes and fresh-database replay, never hand-authored schema DDL. Do not delete unrelated user work or rewrite Git history during source implementation. Physical-folder cleanup, including worktree retirement or repository reconstruction, is a separate reviewed phase. Report external binaries that still use old protocol names as incompatible with the new release.

## Verification

Run focused tests for each unit, then the repository's required typecheck, test, and build commands. Search tracked contents and filenames case insensitively for joined, spaced, hyphenated, and underscored spellings. Inspect tracked archives/binaries, lockfile, and generated assets that will be exported. Repeat checks on a fresh export after install/build. Confirm old `.git`, nested worktrees, and the parent path are absent from the new repository; preserve pre-existing untracked work until its owner selects files for inclusion. The old physical folder is governed by the separate optional cleanup plan.
