import { readCommanderWarmControl, type CommanderWarmControl } from "../lease/commander-warm-control.js";
/**
 * `Supervisor` — the sandbox lifecycle orchestrator (WRK-004).
 *
 * It is the real implementation behind the WRK-003 `SupervisorSeam`: the poll
 * loop hands it an ACKed lease (`accept`) and it drives the whole run INSIDE a
 * provider sandbox — never in the worker process:
 *
 *   create → attempt_started → execute (in sandbox) → terminal → destroy
 *
 * under the EFFECT authority (the happy path). Abnormal paths — a hung create, a
 * cancel, a lease loss, or shutdown — WITHDRAW effect authority and route through
 * the DISTINCT, monotonic CleanupAuthority, which can only cancel → kill →
 * destroy (escalating on non-compliance) and read a redacted projection. The
 * escalation reclaims the whole process tree.
 *
 * Every sandbox identity + provider op id is attached to the emitted events, the
 * structured logs, and the cleanup records; resource labels are HASHED before
 * they enter any log or metric.
 *
 * Runtime imports: relative modules + the frozen protocol type carried on the
 * handoff — the E4-D01 boundary.
 */

import { randomUUID } from "node:crypto";
import { browserDispatchRefusal, readBrowserNetworkPolicy, BROWSER_CONFIG_PATH, BROWSER_RUNNER_PATH } from "./browser-dispatch.js";
import { createBrowserApprovalController, type BrowserApprovalController } from "./browser-approval.js";
import { deliverBrowserApproval } from "./browser-approval-delivery.js";
import { createBrowserOutput } from "./browser-output.js";
import type { WorkerSelfModel } from "../poll/capacity.js";
import { readStagedInputPointers } from "../lease/staged-input.js";
import type { ControlCommandV1 } from "@armyofagents/worker-protocol";

import { artifactPreparedPayloadV1Schema } from "@armyofagents/worker-protocol";
import type { ArtifactPreparedPayloadV1, LogPayloadV1, ProgressPayloadV1, UsagePayloadV1 } from "@armyofagents/worker-protocol";

import type { LeaseHandoff, SupervisorSeam } from "../poll/poll-loop.js";
import type { Logger } from "../logging/logger.js";
import {
  CLEANUP_ESCALATION_METRIC,
  CLEANUP_OUTCOME_METRIC,
  SANDBOX_OP_METRIC,
  type Metrics,
} from "../metrics/metrics.js";
import { CleanupAuthority, ResourceNotAvailableError } from "./cleanup-authority.js";
import { EffectAuthority, type EffectFence } from "./effect-authority.js";
import { EventSequencer, type EventDeliveryIdentity, type WorkerEventSink } from "./events.js";
import { createNoopProvider } from "./noop-provider.js";
import {
  hashResourceLabels,
  type CreateSandboxSpec,
  type ExecuteResult,
  type ProviderOpContext,
  type ResourceLabels,
  type SandboxProvider,
  type SandboxOutputEntry,
  type StagedFileRequest,
} from "./provider.js";
import type { RunCanaryCoordinator } from "./run-canaries.js";
import { createCommanderLiveOutput } from "./commander-live-output.js";
import { labelsEqual } from "./provider.js";
import { RUN_OUTPUT_DROPPED_METRIC, createRunOutputCapture, scrubOutputText } from "./run-output.js";
import { ENV_PROBE_DEFAULT_DEADLINE_MS, ENV_PROBE_ERROR_CODES, envProbeLogMessage, runEnvProbe } from "./env-probe.js";
import { PROVIDER_AUTH_ENV_TARGETS } from "../lease/secret-redemption.js";
import {
  parseServiceWorkload,
  runServiceLifecycle,
  SERVICE_HEALTH_TICK_MS_DEFAULT,
  type ServiceStopHandle,
} from "./service-lifecycle.js";
import { EXPORT_TEARDOWN_RESERVE_MS, RUN_TEARDOWN_HEADROOM_MS } from "../lifecycle/run-op-deadline.js";
import {
  ArtifactExportFailedError,
  exportReasonCode,
  type ArtifactExportRequest,
  type ArtifactExportSequencer,
  type ExportedArtifactRef,
  type SandboxArtifactExporter,
} from "../lease/artifact-export.js";
import { isOwnedLabelsCapabilityShape, type OwnedLabelsCapabilityLike } from "../lease/owned-labels-capability.js";

/** CLI-003/D3 — a captured stdout/stderr/system log line to turn into a `log` event. */
export interface RunObservationLogEntry {
  readonly stream: LogPayloadV1["stream"];
  readonly level?: LogPayloadV1["level"];
  readonly message: string;
}

/** CLI-003/D3 — a progress tick to turn into a `progress` event. */
export interface RunObservationProgressEntry {
  readonly message: string;
  readonly percent: ProgressPayloadV1["percent"];
}

/**
 * CLI-003/D3+D5 — the bounded observation captured from a completed sandbox run:
 * log output (stdout/stderr/system), progress ticks, and EVIDENTIARY-ONLY usage.
 * In the wired world this is populated from the D1 transport streaming callbacks +
 * the adapter's token/runtime accounting; the live population channel is the inert
 * E4-D12 seam, so CLI-003 wires the seam + unit-tests it. Usage never carries a
 * price — JOB-012 prices server-side.
 */
export interface RunObservation {
  readonly logs?: readonly RunObservationLogEntry[];
  readonly progress?: readonly RunObservationProgressEntry[];
  readonly usage?: UsagePayloadV1 | null;
}

/**
 * WRK-018 — what the supervisor itself observed of a completed run, handed to `observeRun`:
 * the run's stdout TAIL from the optional provider stream channel, already scrubbed by the
 * run's own canaries (`run-output.ts`), and the execute window on the SUPERVISOR's clock.
 * Present whenever an `observeRun` is composed; `stdoutTail` is `""` when the provider does
 * not implement the channel or streamed nothing.
 */
export interface RunOutputObservation {
  readonly stdoutTail: string;
  readonly runtimeMillis: number;
  /** Scrub strings decoded from JSON before an observer serializes them into a diagnostic. */
  readonly scrubText?: (text: string) => string | null;
}

/** The max number of captured `log` events a single run may emit, leaving headroom
 * under the frozen 500-event batch cap for attempt_started/progress/usage/terminal.
 * Envelope-level (≤500-event / ≤3.75 MiB) batching itself is the durable sink's job. */
const MAX_LOG_EVENTS = 480;

/** The worker's stable identity (targetId + deviceGeneration) — not carried on a
 * per-lease handoff, so it is bound once at supervisor construction. */
export interface WorkerSupervisionIdentity {
  readonly targetId: string;
  readonly deviceGeneration: number;
}

export interface SupervisorDeps {
  readonly browserSelfModel?: WorkerSelfModel;
  /**
   * The DESKTOP/in-process provider (the `E2bSandboxProvider` on the self-hosted lane).
   * OPTIONAL since DEP-011 Slice 2a: a CONTAINER worker instead injects `makeRunProvider`
   * (a per-run networked driver factory) — exactly ONE of `provider`/`makeRunProvider`
   * may be set, and `!provider && !makeRunProvider` is a `no_provider` refusal upstream
   * (`compose-dispatch.ts`). Fail-fast at construction if both are present.
   */
  readonly provider?: SandboxProvider;
  /**
   * DEP-011 Slice 2a — the PER-RUN networked provider FACTORY (a TYPE here; the impl comes
   * from the OUTSIDE composition root, DEP-011 Slice 2b). The capability does not exist at
   * `buildRun`, so the container branch builds NO-OP null-object authorities there and REBUILDS
   * the real authorities over `makeRunProvider({handoff, capability})` INSIDE `runLifecycle`
   * AFTER redemption. SYNC (no `await` between the two authority reassignments — §2a.3). REQUIRES
   * `materializeRunSecrets` (the rebuild only runs inside its block) — fail-fast pairing them.
   */
  readonly makeRunProvider?: (input: { handoff: LeaseHandoff; capability?: OwnedLabelsCapabilityLike; warmControl?: CommanderWarmControl }) => SandboxProvider;
  readonly identity: WorkerSupervisionIdentity;
  readonly eventSink: WorkerEventSink;
  readonly metrics?: Metrics;
  readonly logger?: Logger;
  /** ms clock (default `Date.now`). */
  readonly now?: () => number;
  /** ISO clock for event `occurredAt` (default real time). */
  readonly nowIso?: () => string;
  readonly newEventId?: () => string;
  readonly newIdempotencyKey?: () => string;
  /** Wall-clock budget for a `create` before the deadline fires (default 30s). */
  readonly createDeadlineMs?: number;
  /**
   * Generic per-op deadline stamped on the op context (default 60s).
   *
   * ★ H1 — may be a FUNCTION of the handoff, resolved ONCE per run at acceptance. That is what
   * lets the composition root derive the deadline from the run's own
   * `workload.maxRuntimeSeconds`, which otherwise never reaches the supervisor at all: this
   * number is simultaneously the execute race, the E2B sandbox TTL, and the E2B command
   * timeout, so a fixed 60 s killed every task that needed longer.
   *
   * The per-run value governs `create` (whose ctx sets the sandbox TTL) and `execute`. Cleanup
   * and teardown ops deliberately keep the BASE deadline: a long run budget is not a reason to
   * let a destroy hang, and the capability those ops run under expires on its own schedule.
   */
  readonly opDeadlineMs?: number | ((handoff: LeaseHandoff) => number);
  /** ms after acceptance the cleanup authority's escalation becomes mandatory. */
  readonly cleanupDeadlineMs?: number;
  /**
   * CLI-008 Unit B — wall-clock budget for the WHOLE staging step (default 30s).
   *
   * ★ ONE budget across BOTH halves, subtracted not added — the R6 shape `secretRedeemDeadlineMs`
   * established for redeem+create. The resolve fetches bytes over the network and the write
   * pushes them into the sandbox; two independent 30 s budgets would make the step's real bound
   * 60 s while every knob still read 30. A bound nobody can compute from the config is not a bound.
   */
  readonly stageInputDeadlineMs?: number;
  /**
   * SVC-008b — the service supervise loop's tick interval, in ms
   * (default {@link SERVICE_HEALTH_TICK_MS_DEFAULT}). Ignored by every non-service run.
   *
   * ★ INJECTABLE BECAUSE §9.3 IS OPEN, not because tests want it fast. The interval sets the
   * durable `service_health` volume (a 10 s tick over 72 h is ~26 000 rows per instance) and
   * it interacts with SVC-003's liveness deadline, so whoever rules on §9.3 changes the
   * composition root rather than this module.
   */
  readonly serviceHealthTickMs?: number;
  /** Injectable timer for the create-deadline race (default node timers). */
  readonly setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
  /** DAT-005 D4 — per-run secret canaries scrubbed from EVERY event this supervisor's
   * lifecycle sequencer emits (attempt_started / terminal / op stream), BEFORE the
   * digest + durable outbox. The canary-seeding channel that populates this is the
   * inert E4-D12 seam; until then it is `[]` (verbatim emit, no secret-bearing
   * supervisor string exists yet — every terminal errorMessage is hardcoded null). */
  /**
   * ★ REQUIRED, deliberately. This was `redactionCanaries?:` with a `?? []` fallback — an
   * OMISSION-BY-DEFAULT in a REDACTION mechanism: a caller that simply forgot got no
   * redaction at all, silently, and nothing anywhere would say so.
   *
   * A fail-open default in a security control is the worst kind of default, because the
   * failure is invisible in exactly the case it matters. Passing `[]` is still allowed —
   * but it now has to be TYPED OUT, which makes "this run has no canaries" a decision
   * someone made rather than one they omitted.
   */
  readonly redactionCanaries: readonly string[];
  /**
   * CLI-003/D3 — an OPTIONAL run-observation source. When present, the supervisor
   * resolves it AFTER `execute` (with the exec result) and emits the captured
   * log/progress/usage producer events between `attempt_started` and `terminal`.
   * Absent (the default) leaves the lifecycle event stream unchanged. Best-effort:
   * a throw is logged and never fails the run.
   */
  readonly observeRun?: (input: {
    handoff: LeaseHandoff;
    exec: ExecuteResult;
    /** WRK-018 — additive; always set by the supervisor when it calls `observeRun`. */
    output?: RunOutputObservation;
  }) => RunObservation | Promise<RunObservation>;
  /**
   * CLI-008 Unit B — resolve the control-plane-staged files for this run, as {path, GRANT}
   * pairs. Absent (the default) ⇒ nothing is staged and the lifecycle is byte-identical to
   * before, which is what keeps staging OPTIONAL for every existing run.
   *
   * ★ GRANTS, NOT BYTES. The composition root reads the staged-input pointer off the frozen
   * envelope and mints a download grant per file over the frozen `artifact_transfer_grant`
   * op; the bytes go store → provider → sandbox and never cross this seam. A bytes-shaped
   * signature would route payloads through a daemon that is dependency-pinned (E4-D01)
   * precisely so it does not handle them.
   *
   * ★ FAIL CLOSED, unlike `observeRun`. `observeRun` is instrumentation and a throw there is
   * swallowed; this is INPUT. A run that was meant to have files and does not is a sandbox
   * whose agent works from the wrong context, terminalizes cleanly, and satisfies every gate
   * downstream while proving nothing. A throw here — resolving OR staging — fails the attempt
   * and escalates cleanup.
   */
  readonly resolveStagedFiles?: (input: { handoff: LeaseHandoff }) => Promise<readonly StagedFileRequest[]>;
  /**
   * DAT-009-3c (E5-D07) — the artifact-export SEQUENCER, built by the dispatch runtime (slice 3d)
   * from the control-plane client, device key and session, none of which the supervisor holds.
   * The supervisor supplies the per-run `exporter` (this run's sandbox, through this run's
   * `EffectAuthority`). Absent, or present with no producer ⇒ inert: no call, no metric, and the
   * lifecycle is byte-identical.
   */
  readonly exportArtifacts?: ArtifactExportSequencer;
  /**
   * DAT-009-3c (E5-D07) — the PRODUCER (CLI-012): names the files this run returns. Requests
   * only, never bytes. REQUIRES `exportArtifacts` (fail-fast at construction: a producer with no
   * one to hand its requests to would silently export nothing on every run).
   *
   * ★ BEST-EFFORT, like `observeRun` and unlike `resolveStagedFiles` (E5-D07). The work is already
   * done; a refused, thrown or timed-out export logs, emits `export_artifact` `failed`/`timed_out`,
   * and continues to the TRUTHFUL terminal — the command's own verdict. The attempt is not failed.
   */
  readonly resolveExportArtifacts?: (input: {
    handoff: LeaseHandoff;
    exec: ExecuteResult;
    /**
     * CLI-012 (E5-D07) — THE PER-RUN SANDBOX VIEW, additive on DAT-009-3c's `{handoff, exec}`.
     *
     * ★ THE PRODUCER IS COMPOSED AT THE BOOT ROOT AND HAS NO SANDBOX OF ITS OWN. It never names
     * a sandbox id: this closure is bound to THIS run's sandbox and THIS run's `run.effect`, so
     * enumeration passes the same fence gate `digestArtifact`/`exportArtifact` do and cannot
     * become a second, quieter door onto a gated action. It also honours the window latch, so
     * an enumeration that resolves after the window closed hands nothing back.
     */
    enumerate: (root: string) => Promise<readonly SandboxOutputEntry[]>;
  }) => Promise<readonly ArtifactExportRequest[]>;
  /** DAT-009-3c — ONE budget for the whole export window (producer + every file), default 30 s.
   * On the networked lane it is further clamped so destroy keeps `EXPORT_TEARDOWN_RESERVE_MS`. */
  readonly exportArtifactsDeadlineMs?: number;
  /**
   * DAT-008 slice 5 — PER-RUN secret materialisation. Given a handoff, redeems the envelope's
   * `env`/`sandbox_local_only` handles and returns the sandbox `env` plus the redeemed values (to
   * seed as per-run redaction canaries). Absent (the default) = no secrets, `env` stays `{}` —
   * byte-identical pre-slice-5 behaviour. A THROW or a TIMEOUT fails the attempt CLOSED: a durable
   * terminal is emitted and cleanup escalated, and NO sandbox is created.
   */
  readonly materializeRunSecrets?: (
    handoff: LeaseHandoff,
  ) => Promise<{ env: Record<string, string>; canaries: readonly string[]; capability?: OwnedLabelsCapabilityLike; warmControl?: CommanderWarmControl }>;
  /**
   * DAT-008 slice 5 — the per-lease canary coordinator shared with the fence-close proxy, so ONE
   * redemption seeds BOTH event streams. Absent = the supervisor uses its own per-run array
   * (seeded from `redactionCanaries`); the proxy sink is simply not fed (unit/non-driver builds).
   */
  readonly canaryCoordinator?: RunCanaryCoordinator;
  /**
   * DAT-008 slice 5 (R6) — the redemption budget, in ms. CARVED FROM `createDeadlineMs` (clamped to
   * it) and SUBTRACTED from the create budget, so a slow control plane cannot extend the run's wall
   * clock. Default 5000.
   */
  readonly secretRedeemDeadlineMs?: number;
  /**
   * DEP-017 — the live env-absence probe (`env-probe.ts`). PRESENT = composed: after stage-in and
   * `attempt_started`, before the tenant command, the probe runs INSIDE the run's sandbox with the
   * run's own env, then again with two planted canaries (the positive control). Any present
   * credential class, a probe that did not run, or a control that did not turn red FAILS the
   * attempt closed. ABSENT (the default) = no probe; the lifecycle is byte-identical. Composed only
   * when the worker boots with `AOA_WORKER_ENV_PROBE=1` (the DEP-015 shipped-boot overlay).
   */
  readonly envProbe?: {
    /** Per probe execute; default 60 s, clamped to the run's op deadline. */
    readonly deadlineMs?: number;
    /** The metadata endpoint to OBSERVE (default `169.254.169.254`); `null` skips it. Test seam. */
    readonly metadataUrl?: string | null;
    /** Test seams for the planted control's random values. */
    readonly randomToken?: () => string;
    readonly foreignOrganizationId?: () => string;
  };
}

export type SupervisorRunStatus = "succeeded" | "failed" | "cancelled" | "create_timeout";

export interface Supervisor extends SupervisorSeam {
  applyBrowserDecision?(command: ControlCommandV1): Promise<void>;
  onAuthorityRenewed(leaseId: string, capability: OwnedLabelsCapabilityLike): void;
