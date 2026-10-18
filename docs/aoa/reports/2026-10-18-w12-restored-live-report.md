# W12 restored live acceptance — 18 October 2026

The bounded continuous isolated journey **passed** on application candidate
`c61b47660d8e2a3007f5059eb2a3577e99581cc2`. A real distributed Codex/E2B run
produced three useful files; native database and object recovery preserved them;
valid retained old authority was refused after cutoff; an independently enrolled
successor produced a useful exact downloadable file. Operator-directed orphan
quarantine and a separate offline missing/corrupt-object recovery branch passed.

This closes the finite W12 rehearsal described below. W14/W15 topology, D5 RPO/RTO,
the W05 PC-worker/UI journey, and automatic daemon orphan recovery remain separate
acceptance work. The [earlier failed rehearsal](2026-10-18-w12-live-rehearsal-report.md)
remains historical evidence. See the [portable results](../evidence/2026-10-18-w12-restored-live-summary.json)
for IDs, hashes, raw-receipt hashes, timings, and cleanup.

## Changes and verification

The candidate fixes all three observed blockers:

- Codex receives the governed OpenAI key through stdin login in a private per-run
  `CODEX_HOME` outside the output root. The key is unset before execution; the
  shell cleanup trap removes the authentication directory.
- Native backup uses one exported source snapshot for its explicit owner-default
  relation ACL manifest and `pg_dump`. A self-contained archive trailer restores
  that representation against the actual restored owner. Column privileges and
  unchanged startup certificates remain intact.
- An organization-admin successor endpoint transfers the canonical canary slug
  between two exact locked tenant targets after completed durable predecessor
  revocation. Only `UPDATE(slug)` is added to the app role. Existing placement
  snapshots, credential binding, generations, identities, and replay rules remain.

Independent implementation and code reviews passed. Targeted Windows and VPS
combined checks each passed **180 tests across nine files**. Selected writer
inventory passed 1 (19 filtered), placement replay passed 2 (38 filtered), API
helper passed 6, and output-probe guards passed 65 with one retired-case skip.
Native PostgreSQL 18.6 backup/restore passed on both hosts, including the normal
startup gate, stale-fence refusal, and two object-recovery cases. Shared, protocol,
daemon, database, and server builds passed on the VPS; applicable local typechecks
passed. No whole-repository suite or authoritative root build was run.

The local combined capture was made on the identical subsequently committed
implementation bytes; its runner records the previous HEAD `f170cf8`, not a clean
`c61b476` checkout. VPS attribution uses the exported candidate manifest: all
**8,372 tracked files** verified before and after tests and after live execution.
Manifest SHA-256:
`6f1e7af1d2fddf3b8ef8d3233dc05aa07570d14c1ab9d06c87d907d22a8938b9`.

## Actual continuous journey

The dedicated namespace used loopback control-plane/adapter-manager/worker ports,
PostgreSQL 18.6, TLS MinIO, separate credentials and volumes, and the pinned E2B
template/build `g31y4dxpd4c8ufmoum40:9bad01cc-576f-46aa-88a8-62ce1a8253f3`.
The normal source control plane and networked worker ran from the candidate source.
The account-wide provider reaper stayed disabled; cleanup used exact owned metadata.
Board authentication used the private `cloud_auth` E2E session seam, not Google OAuth.

1. A bounded legacy warmup established the initial fleet before supported operator
   legacy reconciliation and rollout. It is setup evidence, not distributed success.
2. Source job `eba4ce85-e2ef-4675-aa68-9483ccd0beb5` ran through distributed
   placement and real Codex/OpenAI execution. Its attempt and heartbeat run succeeded.
   Normal HTTP downloads matched the exact expected bytes, size, and SHA-256 for
   `invoice-summary.json` (196 bytes), `invoice-lines.csv` (52), and
   `invoice-summary.txt` (102). The invoice reconciliation totals 11 units and 119.
3. A second real job supplied an ACKed active lease. The retained session, consumed
   enrollment-code replay, and that exact lease each passed a pre-cutoff HTTP 200
   positive control. Writers were stopped and the lease was still active at backup.
4. Native SQL.gz and stopped-MinIO snapshots were restored into new database and
   object volumes. Compatible destination roles were provisioned before restore,
   migrations checked, and the unchanged normal startup gate passed **without
   manual ACL repair**. Durable target cutoff and offline fanout completed before
   restored serving. Every restored company's committed artifacts were reconciled.
5. At 05:59:54–05:59:57 UTC, the same retained session was still valid until
   06:13:39 UTC and its enrollment code until 06:07:36 UTC. Session renewal and
   code replay returned 401; the exact retained active lease returned 409
   `target_revoked`. Freshly signed event upload and ordinary artifact commit also
   returned 409 `target_revoked`; the selected event/artifact rows and exact retained
   lease used by the probe's digest were unchanged. This is not a digest of every
   governed table.
   The critical recovery sequence took 79.601 seconds. This is a finite
   rehearsal duration, not a D5 RTO measurement.
6. All three source outputs downloaded exactly through normal HTTP after restore.
7. The successor API moved routing to target
   `6cc8e4ee-07df-4d58-b58c-cdc64e2e350e`. Its new worker UUID and public-key
   thumbprint differ from predecessor target
   `6796cdee-70a2-4e59-8c1c-936002245583`. The submitted replacement task initially
   queued behind the interrupted run. With fanout having made that old job
   `cancelled` and its lease `revoked`, the supported board
   `POST /api/heartbeat-runs/:runId/cancel` closed its still-running heartbeat run
   and freed the agent slot. No database status edit or fabricated worker terminal
   was used. Recovery operators must perform this step before relying on the same
   agent's next queued task. The same queued issue then became replacement job
   `78d877c4-9931-499d-87e2-b2f2b92441ae` succeeded at the run/attempt level and
   exported `replacement-summary.json`: 107 exact downloaded bytes, sorted values
   `[2,11,17]`, sum 30, and the rehearsal nonce.
8. Using genuine replacement CLI bytes and actual job/lease/device provenance, an
   operator-directed late-output specimen passed the device quarantine grant,
   checksum-bearing HTTPS PUT, and finalize flow. Receipt
   `5f3338e7-bd9e-4c4f-8a57-a19107f75b3e` was visible as quarantine in normal board
   job detail; no ordinary output projection was created.
9. After stopping all writers, another paired native/object snapshot was restored
   into a fresh **fault fork**, retaining the clean volumes. Only the CSV key was
   deleted and the text key changed to different same-length bytes. The actual
   offline reconciliation CLI classified `missing` and `hash_mismatch`, quarantined
   exactly those artifacts, and left the JSON sibling verified. Restoring the two
   original byte sequences and reconciling again retained `already_quarantined`
   with one audit event per artifact. The production content service returned
   scoped 404 for both quarantined outputs and the exact healthy sibling stream.
   The fault application was never served.

Run/attempt success and exact committed bytes establish useful work here. The
raw parent `jobStatus` was still `running` at capture because normal aggregate
finalization waits for lease expiry/reaping. This report does not claim an
immediate job-finalization path. The ordinary-commit denial uses a real earlier
committed output whose source attempt was already terminal; it is not a
pre-cutoff same-request HTTP 200 replay. Orphan evidence is explicitly an injected
late-output specimen, not automatic staged-output recovery after a daemon crash.

## Failed attempts and isolation

Failed setup and measurement attempts were retained rather than counted green:
the VPS default 2 GB compiler heap exhausted memory (a process-only 4 GB limit
passed); two suites initially lacked a writable test home (an isolated home
passed all 180); the first live run needed fleet reconciliation after a legacy
lease was created. Its initial harness also incorrectly required immediate parent
job success. Fresh destination roles omitted `NOINHERIT`; diagnostics found the
catalog, grants, and definers already correct, with only that global role attribute
wrong. Correcting it after restore passed startup but exhausted the code window,
so that attempt makes no authority-denial claim. It was archived and the final
journey repeated with correct role provisioning **before** restore.

The replacement observer initially timed out while the interrupted run held its
agent slot; the supported cancel route then dispatched the same queued issue.
The first injected-orphan PUT lacked the checksum header and finalize refused it;
the helper then used the shipped `grantPutHeaders`, and the real retry passed.
Provider kill acknowledgement briefly preceded inventory convergence; a later
bounded inventory confirmed zero remaining owned sandboxes.

All test resources are now gone: zero owned processes, listeners, containers,
six owned volumes removed, and zero active/paused owned provider sandboxes. Local
review ports 3210/54329 retain PIDs 6780/11492 and original start times. VPS shared
review PID 301667, unit configuration, database full identity/start time, and
HTTP 200 health are unchanged. No shared deployment, W02/W05 edit, or main merge
was performed.

Old local source tar files (624,312,320 bytes combined), unused W12 worker images,
three obsolete VPS setup trees, and their exact unused labeled volumes were
removed after retaining compact evidence. The completed current VPS staging tree
(2,326,847,717 logical bytes) was also removed after verifying every selected
archive member. Reusable pinned runtimes, base images, E2B template, active
worktrees, and protected provider configuration remain for faster repeats.

Final archive: `/opt/aoa-w12-evidence-archive-20261018/aoa-w12-acceptance-20261018.tar.gz`,
1,237,596 bytes, 129 files, SHA-256
`de96082997274c92183ad32492d1cc22b8d872269ef827c70b8ea495b27298b9`.
It includes helpers, backups, raw captures, the incomplete attempt, source manifest,
and safe portable results. Supplied provider credentials were excluded and retained
separately with mode 0600. Archive and portable results were copied locally and
their SHA-256 values verified before publication.
