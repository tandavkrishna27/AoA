# Plugin Platform Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task by task. Checkboxes track completion.

**Goal:** Replace all legacy plugin naming with AoA-only identifiers while retaining first-party plugin discovery and execution.

**Architecture:** Define canonical AoA manifest, bridge, SDK, dev-server, and scaffold names. Change host and guest sides in a coordinated sequence; no legacy aliases remain.

**Tech Stack:** TypeScript, React, pnpm workspace, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-aoa-clean-break-design.md`

## Global Constraints

- No old-brand token in tracked content or paths.
- One canonical manifest key, e.g. `aoaPlugin`, used by loader, watcher, examples, and scaffold.
- One canonical UI bridge global and server dispatcher global, named with `aoa`.
- Preserve capability checks, worker isolation, UI component registration, and plugin key routing.
- Package manifest changes require a regenerated lockfile in the same PR; only the coordinator edits the lockfile.

## Review Focus

- Example plugin manifests must still be discovered by the loader.
- UI slots must receive the bridge before loading guest components.
- Sandbox module wrappers must expose the renamed dispatcher and module globals.
- Installed plugin ID mapping must not incorrectly collapse distinct AoA keys.
- Dev server health/event routes and executable name must agree with generated scaffold output.

---

### Task 1: Shared and SDK contract

**Files:** Modify `packages/shared/src/types/plugin.ts`, related exports/validators/tests, and `packages/plugins/sdk/src/{define-plugin,types,index,protocol,ui/runtime,ui/components,dev-server}.ts` plus package metadata/tests.

**Interfaces:** Export AoA manifest/plugin types and AoA bridge names consumed by host code.

- [ ] Write failing type/runtime tests for the canonical exports, bridge lookup, and dev routes.
- [ ] Rename exports and internal identifiers; retain shape and behavior.
- [ ] Run SDK and shared focused tests/typecheck; confirm success.
- [ ] Commit the contract package changes.

### Task 2: Host integration

**Files:** Modify `server/src/{app.ts,services/plugin-*.ts,routes/plugins.ts}` and `ui/src/plugins/{bridge-init,bridge,slots}.tsx` as applicable, with focused tests.

**Interfaces:** Consume Task 1 names; accept only the canonical manifest key and plugin IDs.

- [ ] Update failing plugin discovery, worker, dispatcher, and UI bridge tests.
- [ ] Rename host/guest access points together; remove old key mapping.
- [ ] Run plugin server/UI focused tests; confirm success.
- [ ] Commit the host changes.

### Task 3: Scaffold and examples

**Files:** Rename `packages/plugins/create-*-plugin/` to an AoA-named path; update its package metadata, generated output directory, templates, first-party example manifests/readmes, root workspace references, and tests.

**Interfaces:** Generated plugins use Task 1 manifest/SDK names and Task 2 host bridge.

- [ ] Add a scaffold smoke test that creates and loads a generated plugin.
- [ ] Rename scaffold package/path and update examples and documentation.
- [ ] Hand manifest changes to the coordinator for the single lockfile regeneration and frozen-install check.
- [ ] Run scaffold and plugin integration tests; confirm success.
- [ ] Commit scaffold/examples with their manifests; coordinator includes the regenerated lockfile in the same PR.
