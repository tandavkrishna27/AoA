# Hermes Adapter Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement task by task. Checkboxes track completion.

**Goal:** Replace the external Hermes dependency with an AoA-owned adapter while preserving the `hermes_local` capability.

**Architecture:** A new workspace package implements the existing server adapter interface using AoA adapter utilities. The server registry imports it directly. The external package is removed from the server manifest and regenerated lockfile.

**Tech Stack:** TypeScript, pnpm workspace, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-aoa-clean-break-design.md`

## Global Constraints

- No former-brand token in tracked content or paths; use the regex in the investigation document.
- Preserve Hermes CLI command, `hermes_local` type, model list, session codec, result parsing, and local execution behavior.
- Use `AOA_API_URL`, `AOA_API_KEY`, `AOA_RUN_ID`, and `AOA_TASK_ID` in the task environment.
- The prompt must show authenticated API calls.
- Change the package and server manifests here; the coordinator regenerates the lockfile once after every area manifest change.

## Review Focus

- Missing JWT must not produce a prompt that instructs an unauthenticated mutation.
- Explicit configured API key must take precedence over generated JWT.
- Session resume must pass the same session identity semantics as the old adapter.
- Process failure, timeout, and malformed output must return honest failure results.
- Windows paths with spaces must not be shell-concatenated unsafely.

---

### Task 1: New adapter package

**Files:** Create `packages/adapters/hermes-local/package.json`, `tsconfig.json`, `src/index.ts`, `src/server/execute.ts`, `src/server/test.ts`, and focused `src/server/*.test.ts` files. Follow nearby local adapter package layout.

**Interfaces:** Produce `execute`, `testEnvironment`, `sessionCodec`, `models`, and `agentConfigurationDoc` exports matching the current `ServerAdapterModule` consumers.

- [ ] Write tests for CLI arguments, env values, explicit key precedence, authenticated prompt, resume, success parsing, error parsing, and timeout.
- [ ] Run those tests and confirm they fail against the absent implementation.
- [ ] Implement the package with `@armyofagents/adapter-utils` process/environment helpers.
- [ ] Run focused tests and package typecheck; confirm success.
- [ ] Commit the package and tests.

### Task 2: Registry and dependency switch

**Files:** Modify `server/src/adapters/registry.ts`, `server/package.json`, `server/src/__tests__/hermes-local-adapter.test.ts`, `server/src/__tests__/hermes-spawn-env.test.ts`, provider catalog tests, and `pnpm-lock.yaml`.

**Interfaces:** Consume Task 1 exports. The registry continues to expose type `hermes_local`.

- [ ] Update wrapper tests to assert AoA env values and preserved precedence.
- [ ] Switch imports and wrapper env names; remove the external package from the manifest.
- [ ] Hand manifest changes to the coordinator for the single lockfile regeneration and frozen-install check.
- [ ] Run focused server tests and `pnpm -r typecheck`; confirm success.
- [ ] Commit the registry/tests and manifest as part of the coordinated dependency change; the coordinator owns the matching lockfile commit.
