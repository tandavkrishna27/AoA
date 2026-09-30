# Core Contracts Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task by task. Checkboxes track completion.

**Goal:** Make server, CLI, shared data, and non-Hermes adapters use AoA-only runtime and persisted names.

**Architecture:** Rename each contract at its producer and all consumers. With no existing users, remove compatibility readers and change fixtures to the new format. Keep company scoping, auth, logging, and execution invariants intact.

**Tech Stack:** Express, TypeScript, Drizzle, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-aoa-clean-break-design.md`

## Global Constraints

- No old-brand token in tracked content or paths.
- Preserve company boundaries and mutation activity logs.
- Use Drizzle generation if schema DDL changes; do not hand-author DDL.
- Do not silently drop any current AoA data field or agent capability.
- Historical migration/snapshot changes require a generated rebaseline and fresh-database replay; no hand-authored schema DDL.
- Only the coordinator edits the lockfile after all manifest changes.

## Review Focus

- Agent JWT and callback headers must agree at both ends.
- Workspace and wake context keys must survive dispatch to every adapter.
- OpenClaw callbacks must use the exact new field names expected by this release.
- Import/export must round trip the new manifest format.
- Feedback envelope sender/receiver validation must agree on the new schema version.
- A fresh database must replay the rebaselined migration history without drift.

---

### Task 1: Auth, execution, and workspace context

**Files:** Modify `server/src/{agent-auth-jwt,middleware/auth,services/heartbeat,services/workspace-resolution,services/internal-agent/aoa-agents/runner}.ts`, `packages/adapter-utils/src/server-utils.ts`, adapter execution files, and focused tests.

**Interfaces:** Canonical AoA JWT issuer/audience, run header, wake/workspace context, skill sync, and workspace sentinel.

- [ ] Update failing tests for JWT, callbacks, dispatch context, skill sync, and workspace resolution.
- [ ] Rename producers and consumers; remove old readers and values.
- [ ] Run focused adapter/server tests and typecheck; confirm success.
- [ ] Commit the contract change.

### Task 2: OpenClaw, feedback, and company portability

**Files:** Modify `packages/adapters/openclaw*/src/**`, `server/src/services/{feedback-bundles,feedback-transmission,company-portability}.ts`, `server/src/routes/routines.ts`, `cli/src/commands/client/company.ts`, shared types/validators, and tests.

**Interfaces:** AoA-only adapter config/wire fields, feedback version strings, signature headers, and bundle manifest.

- [ ] Write or update round-trip and callback tests for exact new names.
- [ ] Rename all producers/consumers and fixtures together.
- [ ] Run focused tests and typecheck; confirm success.
- [ ] Commit the change.

### Task 3: CLI configuration and remaining server values

**Files:** Modify `cli/src/{index,config/**,prompts/**,commands/**}`, `cli/package.json`, root `package.json`, server defaults, shared enums, DB seed/default code, and tests.

**Interfaces:** `aoa` CLI and AoA home/config/backup defaults; no legacy alias.

- [ ] Update CLI home, config, command, and backup tests for AoA-only behavior.
- [ ] Rename implementations and remove compatibility modules where unneeded.
- [ ] Hand manifest changes to the coordinator for the single lockfile regeneration and frozen-install check.
- [ ] Run focused CLI/server tests and typecheck; confirm success.
- [ ] Commit implementation and manifests; coordinator includes the regenerated lockfile in the same PR.

### Task 4: Database migration history

**Files:** `packages/db/src/migrations/*.sql`, `packages/db/src/migrations/meta/*`, migration journal, `packages/db/src/revert-0188.ts`, schema sources, and database migration tests. Inventory the 133 matching migration/snapshot files before changing them.

**Interfaces:** Produce a Drizzle-generated AoA-only baseline that creates the current schema from an empty database.

- [ ] Preserve the journal sequence, record changed historical hashes, and verify a fresh replay. Existing databases require reset or an explicit journal remap.
- [ ] Inspect custom migration effects, migration snapshot gates, and the recovery command tied to migration 0188; retire or replace that command before removing its referenced SQL/journal entry.
- [ ] Generate migration artifacts through the repository's Drizzle workflow; do not hand-author schema DDL.
- [ ] Update migration tests for the new baseline and remove obsolete old-value assertions.
- [ ] Run empty-database migration replay and schema comparison, then database package tests/typecheck.
- [ ] Commit schema, generated migration artifacts, journal, and tests together.
