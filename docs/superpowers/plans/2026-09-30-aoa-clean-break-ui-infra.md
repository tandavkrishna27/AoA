# UI and Deployment Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task by task. Checkboxes track completion.

**Goal:** Remove old-brand UI and deployment names while preserving AoA's current application flows.

**Architecture:** UI names follow the new core/plugin contracts. Docker, Compose, and scripts share one set of AoA path and database defaults. Generated assets are rebuilt from source.

**Tech Stack:** React, Vite, TypeScript, Docker Compose, PowerShell/shell scripts, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-aoa-clean-break-design.md`

## Global Constraints

- No old-brand token in tracked content or paths.
- Keep company selection context and surface API failures.
- Preserve all current task, workspace, import, and attachment interactions.
- Do not alter pre-existing untracked/ignored artifacts.

## Review Focus

- New service worker activation must enumerate and clear prior cache keys without embedding an old-name literal; with no users, no targeted migration is needed.
- The project repo-only sentinel must match the server resolver.
- The skill source badge must match the shared/API enum and still display AoA.
- Attachment controls must remain visible and accessible after icon replacement.
- Compose database values must match health checks, bootstrap, scripts, and documentation.

---

### Task 1: UI state and copy

**Files:** Modify `ui/index.html`, `ui/public/sw.js`, `ui/src/lib/storage-*.ts`, `ui/src/adapters/openclaw/config-fields.tsx`, `ui/src/components/{NewProjectDialog,TaskDetail,NewIssueDialog,CommentThread}.tsx`, other icon users, `ui/src/pages/CompanyImport.tsx`, onboarding/workspace components, and focused tests.

**Interfaces:** Consume the canonical plugin/core contract names from the other plans.

- [ ] Update failing UI tests for state keys, sentinel/config fields, skill badge, import copy, and attachments.
- [ ] Implement AoA-only names and use a non-legacy icon export for attachments.
- [ ] Run focused UI tests, typecheck, and build; confirm success.
- [ ] Commit UI source and tests.

### Task 2: Deployment defaults and scripts

**Files:** Modify `Dockerfile`, Docker entrypoint, `.env.example`, `.gitignore`, `.dockerignore`, `docker-compose*.yml`, `scripts/{compose-database-url,deploy/write-compose-env,backup-db,...}`, `.changeset/config.json`, `evals/promptfoo/tests/*.yaml`, `tests/e2e/**`, release workflows/URLs, onboarding and smoke scripts, launch configuration, and related tests.

**Interfaces:** Canonical AoA home/container path, Postgres user/password/database, S3 defaults, and backup prefix.

- [ ] Update failing URL/bootstrap/entrypoint tests for the new defaults.
- [ ] Rename every producer and health-check consumer; remove the old path symlink and guard.
- [ ] Check release, evaluation, end-to-end, onboarding, and smoke paths for live old defaults; coordinate the modified launch configuration with its owner because its absolute parent path is unchanged.
- [ ] Run compose config validation, focused tests, and a Docker build if available; confirm success.
- [ ] Commit deployment files and tests.
