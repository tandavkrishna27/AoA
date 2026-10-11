# B12 upstream gate and owner request

**Purpose:** Collect the concrete replatform contracts and external ownership needed to start B12 safely. This is a source/evidence request, not approval to implement or change runtime security policy.

**Universe source reviewed:** `13b4e806f31a67c3c172f2216272570203132f8f` (`docs/replatform-program`).
**Universe integration:** `9b8f2149fcfccae4754c6e0a1b6f5ed9569353e9`.
**Universe docs branch tip:** `40977bae6ae4e57b2f2f3eed4b63bde2674d984b` (`codex/universe-interface`).

## Request for the replatform owner

Please answer with current branch/commit and exact repository evidence. If a contract is not implemented, say so explicitly and identify its owner and expected delivery point.

### 1. E2.2/2.a accepted output binding

Identify the authoritative producer for the accepted Commander output slot and the cancellation/claim decision. Please include:

- Exact service/API symbol, file path and exported contract that binds an admitted job and attempt to the stable accepted output-slot identity.
- The transaction or compare-and-swap boundary that owns claim token, supersession/cancellation validity, and acceptance. State which store is authoritative and how retries are idempotent.
- The persisted records/events and their ordering guarantees, including how stale attempts and a cancelled/superseded attempt are rejected.
- Existing tests that exercise replay, competing attempts, stale claim, cancellation races, and recovery; include commands and results.
- If this producer does not yet exist, the planned owner and prerequisite ticket/PR. Do not propose creating a second acceptance authority in Universe.

### 2. Worker-owned browser attachment

The current Universe guard rejects CDP ports, remote-debugging switches and exposed endpoints. Official `@playwright/mcp` documentation describes MCP-owned launch, CDP, Playwright WebSocket, and browser-extension modes; it does not document sharing an already worker-owned `Browser`/`BrowserContext` over a pipe.

Please identify the supported Browser Use package and pinned version, and answer:

- Can a worker-native adapter use the existing worker-owned Playwright object/pipe in process without CDP or a remote WebSocket endpoint? Provide the API contract and a minimal existing example/test.
- Which process owns the browser and context, and how are admission, approval, tenant isolation, cancellation, process isolation and teardown enforced?
- If no such seam exists, what upstream design owner and review are needed? Any proposal to expose CDP/WebSocket or weaken the launch guard must be submitted as a separate security/architecture change for review, not treated as a B12 implementation detail.

### 3. Independent placement qualification

Name accountable owners and concrete environments for both tracks; evidence from one does not close the other.

- **Cloud:** accepted image/tier, project/environment, authenticated media/input transport, metadata isolation, controller fencing, native-dialog/tab capability test, and the operator who can run and attest qualification.
- **Local:** supported desktop worker build, second authorized device, browser-only capture, disconnect/input denial and same-session reconnect test, plus the operator who can run and attest qualification.
- For either track, list required credentials/access, safety boundary, test commands or runbook, success evidence location, and any unavailable prerequisite with its owner and ETA.

## Exit decision

B12 can enter implementation planning only after the source owner identifies a real E2.2/2.a authority seam and an adapter design that preserves the current guard, or explicitly records that the relevant increment remains blocked. B12 runtime qualification additionally requires independently authorized cloud and local environments. Re-review against the resulting exact replatform commit before coding; do not infer readiness from an upstream roadmap statement or a local mock.
