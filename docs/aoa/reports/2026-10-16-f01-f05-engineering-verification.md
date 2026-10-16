# F01 through F05 engineering verification

- **Tested application:** `c3c22ef6128d40d04b34be91c371a801dd892452` on `codex/replatform-baseline-w00-w04`.
- **Scope:** Code fixes and local/CI verification. This report supplements the [Local + VPS validation report](2026-10-16-local-vps-validation-report.md); it does not replace that attempt's live failures with passes.
- **Publication:** A documentation-only successor to the tested application commit. No application rebuild or live retest is implied by publishing this record.

## Implemented fixes

| Finding | Result |
|---|---|
| F01 | Native/cloud Codex extraction, compaction and readiness place the root approval option before `exec`; approval policy `never`, read-only sandbox and model/auth selection are preserved. |
| F02 | Streamed, thrown, empty and reasoning-only failures remain failed. Runtime model/provider fields remain null when not observed. Partial failed replies retain an atomic failure marker and replay without repeating tools or inventing an outcome for an interrupted call. Skip/rejoin cleanup respects the authoritative run. Error guidance survives UI reload. |
| F03 | Governed `create_task` accepts validated optional `workMode`, forwards Planning through stored approval parameters, and preserves the default when omitted. Existing Planning dispatch guards remain in force. |
| F04 | Instructions use valid question/options payloads. Legacy aliases and persisted raw choices render as conversational choices; answered choices remain dismissed. Selecting a choice sends user intent and does not grant runtime approval. |
| F05 | The built CLI bundles the validator runtime with its workspace code. A real esbuild/Node subprocess smoke checks strict CLI package dependency resolution. No dependency manifest or lockfile change was retained. |

The [Commander API contract](../../api/internal-agent.md) and generated tool references are synchronized. The real LF-normalized Commander instructions bundle measures 27,012 bytes; combined MCP configuration and instructions measure 27,258 bytes within the unchanged 48,960-byte ceiling.

## Accepted engineering results

Local checks used isolated Node **24.19.0**, pnpm **9.15.4**, Windows x64 and two Vitest workers. Heavy local test/build/typecheck lanes were serialized. `AOA_RUN_WIN_INTEGRATION` was unset for the normal full suite; platform and opt-in skips are not passes.

| Check | Native result |
|---|---|
| Frozen install | Pass; final package manifests and lockfile unchanged. |
| Recursive typecheck | Exit 0; 102.26 seconds. |
| Complete Windows suite | 2,527 files passed, 227 skipped; 24,395 tests passed, 2,131 skipped; exit 0; 305.31 seconds. No unhandled-error summary. |
| Authoritative root build | Exit 0; 94.22 seconds; network-free prebuild; tracked bytes unchanged. |
| Actual built CLI | `--help` and `onboard --help` both exit 0 after the authoritative build. These are module-loading/command smokes, not actual onboarding. |
| Required CI | Pass; all 16 jobs successful, including `ci-required`, on the tested application SHA. [Run 38923364076](https://github.com/tandavkrishna27/AoA/actions/runs/38923364076). |

Counts come from native final summaries. The capture utility's generic summary/unhandled counters remain `unknown`; they were not rewritten. Local raw stdout/stderr/exit receipts remain in ignored `.tmp/f01-f05/c3c22ef61-{suite,typecheck,build}/`, not clone-accessible repository attachments. CI supplies the environment-backed policy, migration, protocol, browser and Linux test/build evidence.

## Retained failures and acceptance limits

The first engineering candidate `34d106949` failed five assertions across three Windows files: stale generated tool references, measured instruction-byte pins after the prompt edits, and an old exec-first argv expectation. That native red result is retained in `.tmp/f01-f05/34d106949-suite/`. The proper generators and source measurements were synchronized, without raising the transport ceiling or weakening safety assertions. The full corrected candidate was rerun to the green result above. The superseded CI run `38922019384` was cancelled and is not accepted evidence.

The original live validation used application `05522b0f2` and remains unchanged. Native **TST-008 remains open** until actual extraction and requested Planning semantics pass. The cloud no-company-key refusal, real Commander choices/approval/reload journey, and disposable built onboarding have separate acceptance cases in the [Local and VPS retest plan](../plans/2026-10-16-f01-f05-live-retest.md). They do not block these engineering fixes; they are required before claiming the corresponding live journeys pass. No live application/VPS setup, provider inference campaign or release rollout was performed for this repair task. F06–F09 and broader program gates retain their own scope.
