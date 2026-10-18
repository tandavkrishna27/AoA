# Local + VPS Validation Plan

Prepared 2026-10-16 from the current replatform completion plan. This document scopes independent live validation only. It does not rebuild or deploy either environment, request credentials, activate rollout flags, or claim results. The previous local and VPS installations were torn down; any future run needs a fresh disposable resource manifest, authority direction, credential custody, expected calls, spending bounds, and cleanup procedure.

**Execution follow-up, 16 October:** The user separately authorized fresh local/VPS validation after this plan. Read the [immutable validation report](../reports/2026-10-16-local-vps-validation-report.md) and [completed-items/pending-fixes pickup checklist](2026-10-16-local-vps-validation-handoff.md). The report includes the subsequent user retry and the test apps retained at handoff; the torn-down installations above describe the pre-validation baseline. Neither successful isolated reruns nor the retry close the remaining native acceptance or broader release gates.

## W01, W03 and W04

These packages have no Local + VPS hard predecessor. Their authorized implementation can proceed against local fixtures, native Windows checks, and required Linux CI.

| Work | Required local/CI evidence | Live or cross-host evidence | Predecessor status |
|---|---|---|---|
| W01 — model defaults | Resolver/auth tests for empty config, retired inherited default, unavailable explicit choice, account/auth changes, API-only catalog entry, outage, malformed model and CLI pin mismatch; assert no API-key fallback. | Required native subscription onboarding → verify → Commander/crew/extraction on the repaired local application after local/CI checks and fresh setup. No model override workaround, Anthropic key, or paid-provider substitute. | Required before claiming the native end-to-end TST-008 journey passes. It is not a VPS prerequisite or a predecessor to implementing W01/W03/W04. Until the application/session is available, record live acceptance as deferred, not passed. |
| W03 — Playwright strict-install parity | Clean frozen pnpm install on Node 24.19.0; package-local browser-runtime suite; deliberate missing/mismatched pin negative control. | None. A VPS adds no coverage to package resolution. | Local/CI is the acceptance predecessor; no live environment dependency. |
| W04 — fixture lifecycle and capture | Capture self-test with both streams and nonzero exit; fresh PostgreSQL databases for ACL sweep, post-sweep assertions, timeout/abort cleanup and next-case health; full Windows startup file and required Linux CI. | None for the captured failure; any later multi-host service campaign belongs to W13/W14. | Windows and required Linux lanes are acceptance predecessors. No VPS dependency. |

## Future Local + VPS work

“Local + VPS” means one logical authority per experiment, with an enrolled PC worker and a separately provisioned remote VPS authority. The reverse direction is a distinct enrollment configuration with the local authority and remote worker; two independent AoA databases never federate. Preserve the selected-row boundary and do not transfer personal auth homes or credential bytes to the VPS.

| Work / journey | Required live evidence | Hard predecessor or deferral |
|---|---|---|
| W05 — actual output/artifact journey | Run the supported app-originated job from the VPS authority to the PC worker; observe lease/fence, file creation, durable output, authorized readback/export/download, cancellation and cleanup. Test the reverse direction only as a separately enrolled authority. | Hard predecessor to claiming the selected cross-host output journey works. The controlled race and deterministic output fixes can land before it. |
| W06 — device credential broker | Enroll the real PC owner/device, activate and revoke a lease-bound reference, retain Internet connectivity while partitioning authority, and verify expiry/restart/fence loss and zero credential-byte exposure. | Hard predecessor to personal-device credential activation claims. Use local/CI denial coverage first. |
| W07 — Windows personal-subscription delegation | Actual AoA application journey to the installed Windows PC worker using its owner-bound personal subscription. Verify useful result delivery, no remote auth-home/key transfer, revocation, restart, offline behavior, and disabled-row refusal. | Hard predecessor to claiming the requested device workflow is implemented. Installed desktop remains unadvertised in this release; positive engineering proof does not activate release exposure. |
| W11 — bounded capacity diagnostic | Separately provision a live daemon/authority pair; reproduce fixed-arrival noisy/quiet contention and record all accepted/completed jobs, queue delay and ACK timings. | Required before choosing a measured performance correction. Full D5 remains on expanded staging. |
| W12 — worker revoke/retire/re-enroll | Revoke or retire a live slot, provision a new target, preserve authority boundaries across restart and prove stale ownership cannot return. | Required for representative live fleet lifecycle claims; adoption remains unsupported absent a separately accepted contract. |
| W13 — service/realtime variants | For shared-authority realtime behavior use two live replicas; exercise authenticated publish/read, reconnect, gap/duplicate handling and service reconciliation. | Two replicas are a hard predecessor to the cross-replica socket case. D4 continuity still requires its complete 72-hour schedule. |

W14/W15 require expanded staging with the declared production-equivalent topology and external stores; the two-host setup alone is insufficient. W17/W18 consume exact-candidate records from their applicable predecessors. Desktop and mobility release rows stay disabled unless an owner later changes scope and the full conditional gates pass. The full D6 campaign remains calendar-bound and cannot be replaced by these engineering smokes.

## Provisioning record required before any live run

Create a separate execution ticket/attempt that names the authority direction, exact candidate SHA and image digests, disposable hosts and network path, selected support-row family and case IDs, approved credential mode, provider/template, expected operations and spend cap, logs/evidence destinations, teardown, and failure/rollback owner. Record native exit, counts, timestamps, candidate and actual execution location. Missing provider/issuer/device access is an explicit prerequisite or deferral for that run; it does not convert a skipped test into a pass. No execution is authorized by this planning document.
