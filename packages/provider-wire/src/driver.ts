// -----------------------------------------------------------------------------
// NetworkedProviderDriver (DEP-012 Slice 1 · Unit A).
//
// Presents the AUTHORITATIVE per-op `SandboxProvider` port over a network hop: each
// implemented op POSTs `{args, ctx}` to the adapter-manager server and deserializes
// `{ok|err}`. It lives OUTSIDE worker-daemon (so the daemon imports nothing new); a
// container composition root (DEP-011) injects it via `deps.provider`, exactly as the
// desktop lane injects `E2bSandboxProvider`.
//
// UNIT A SCOPE. Only `create` + `execute` are wired. The other core ops + the optional
// trio + the artifact pair throw the AUTHORITATIVE `UnsupportedProviderOperation` (the
// worker-daemon class, re-exported via the e2b leaf's `errors.js`) until Unit B builds
// their routes + the server-side ownership gate. `execute`'s route here has NO ownership
// gate and is COMPONENT-TEST-ONLY / not deploy-safe (S1.4).
// (Superseded for the artifact pair by DAT-009-3e: `digestArtifact`/`exportArtifact` now
// relay as gated owned ops — see `artifactExportMode` below.)
//
// ★ execute (ONLY) applies the driver-owned zero-deadline short-circuit BEFORE any RPC
// (`deadlineMs <= 0` -> the deterministic timedOut verdict). `create` has no such
// short-circuit — `CreateResult` has no `timedOut` field and the provider substitutes a
// default TTL for a non-positive deadline (e2b-provider.ts #ttl), so there is nothing to
// mirror. Uses Node's global `fetch`; a caller may inject one (tests spy on the hop).
// -----------------------------------------------------------------------------

import type {
  ArtifactDigestResult,
  ArtifactExportMode,
  FileStagingMode,
  StageFilesResult,
  EnumerateOutputsResult,
  SandboxEnumerationMode,
  SandboxLifetimeResult,
  BrowserDecisionDeliveryInput,
  BrowserDecisionDeliveryResult,
  BrowserCredentialDeliveryInput,
  BrowserCredentialDeliveryResult,
  SandboxOutputEntry,
  StagedFileRequest,
  ArtifactExportResult,
  CheckpointMode,
  CheckpointResult,
  CleanupResult,
  CreateResult,
  CreateSandboxSpec,
  ExecuteInput,
  ExecuteResult,
  HealthMode,
  HealthResult,
  InspectResult,
  ListInput,
  ListResult,
  ProcessHandle,
  ProcessSignalResult,
  ProcessStartResult,
  ProcessStatusResult,
  ProcessSupervisionMode,
  ProviderOperation,
  ProviderOpContext,
  RedactedResourceProjection,
  ResourceLabels,
  ResourceSummary,
  RestoreResult,
  SandboxProvider,
  StopResult,
} from "@armyofagents/worker-daemon";
import type { ArtifactUploadGrantV1 } from "@armyofagents/worker-protocol";
import { CORE_PROVIDER_OPERATIONS } from "@armyofagents/worker-protocol";
import { ResourceNotAvailableError, UnsupportedProviderOperation } from "@armyofagents/sandbox-e2b-provider/errors.js";

import {
  EXECUTE_LIVE_STDOUT_KEY,
  EXECUTE_CAPTURE_STDOUT_KEY,
  EXECUTE_STDOUT_TAIL_KEY,
  WireProtocolError,
  decodeOpResponse,
  encodeOpRequest,
  isValidCapability,
  decodeProcessStart,
  decodeProcessStatus,
  decodeProcessSignal,
  decodeBrowserDecisionDelivery,
} from "./codec.js";
import type { OwnedLabelsCapability, WarmResourceCapability } from "./capability.js";
import type { RedactedListResult } from "./projection.js";

export interface NetworkedProviderDriverOptions {
  /** The adapter-manager base URL, e.g. `http://adapter-manager:PORT`. */
  readonly baseUrl: string;
  /** Injectable fetch (default: the global). Tests spy on the network hop through it. */
  readonly fetch?: typeof fetch;
  /**
   * The owned-labels capability the driver attaches to GATE-REQUIRED ops (DEP-012
   * Unit B1: `execute` + the teardown/read ops; Slice 3 · β1 adds `create`). Sourced
   * OUT-OF-BAND — the `SandboxProvider` port ops have NO capability slot, so it is
   * injected here (the container composition root / DEP-011 supplies the control-plane-
   * minted token), NOT threaded through the caller. On a KEYED server `create` now
   * carries it (the create-gate verifies + label-matches + namespaces the ledger); an
   * UNGATED server ignores it (create's Unit-A body is byte-identical when it is absent).
   */
  readonly capability?: OwnedLabelsCapability;
  /** Relay pause/resume only when the selected target explicitly supports both. Default off. */
  readonly enableLiveStdout?: boolean;
  readonly enableCheckpointRestore?: boolean;
  readonly enableLifetimeRenewal?: boolean;
  readonly enableProcessSupervision?: boolean;
  readonly warmResourceCapability?: WarmResourceCapability;
}

export class NetworkedProviderDriver implements SandboxProvider {
  // Shape-faithful to the port contract ("always a superset of the 8 core ops").
  // Unit A only IMPLEMENTS create + execute; the rest throw until Unit B — an honest
  // "not built yet", not a silent no-op.
  readonly advertisedOperations: ReadonlySet<ProviderOperation>;
  readonly checkpointMode: CheckpointMode;
  readonly healthMode: HealthMode = "none";
  /**
   * DAT-009-3e — `"grant_upload"`: this driver RELAYS the artifact pair over the wire, as it
   * relays `stage_files` (E7-F011). `digest_artifact` / `export_artifact` are NOT members of the
   * frozen `ProviderOperation` vocabulary (they are `DeclinableOperation`s), so `#post`'s op type
   * is widened LOCALLY, never the vocabulary. Both are GATED OWNED OPS on the adapter-manager:
   * they read out of, or upload from, one live sandbox, so the capability rides every call.
   *
   * ★ THE MODE IS READ, NOT DECORATIVE. Both methods refuse with `UnsupportedProviderOperation`
   * before any RPC when this says `"none"` — the rollback is to set it back, and before 3e the
   * methods threw without ever consulting it, so `"none"` was enforced by nothing.
   *
   * Like `fileStagingMode`, it asserts only that the driver can RELAY: a far provider that is
   * `"none"` throws `UnsupportedProviderOperation`, which the codec carries back as its own
   * class. Grant in, reference out — no bytes cross this hop (Option D).
   */
  readonly artifactExportMode: ArtifactExportMode = "grant_upload";
  /**
   * E7-F011 — `"grant_download"`: this driver RELAYS staging over the wire (the route CLI-008
   * Unit B's comment called "its own piece of work"). `stage_files` is still NOT a member of
   * the frozen `ProviderOperation` vocabulary (deliberately — see `FileStagingMode`); the
   * route is added by widening `#post`'s op type LOCALLY to `ProviderOperation | "stage_files"`
   * (never the frozen vocabulary), and `stageFiles` below POSTs `/op/stage_files`. Like
   * `create`/`execute`, the mode asserts only that the driver can RELAY the op — if the FAR
   * provider is `"none"`, its `stageFiles` throws `UnsupportedProviderOperation`, which the
   * codec carries back and re-throws client-side. Honest failure, not a silent drop.
   */
  readonly fileStagingMode: FileStagingMode = "grant_download";

  /**
   * Process supervision is an explicit relay opt-in. The adapter-manager checks the
   * far provider's mode and owned resource before dispatch. Unsupported peers refuse;
   * no launch or process-state observation is synthesized. These local operations
   * do not extend the frozen ProviderOperation vocabulary.
   */
  readonly processSupervisionMode: ProcessSupervisionMode;

  readonly #enableLiveStdout: boolean;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  #capability?: OwnedLabelsCapability;
  readonly sandboxLifetimeMode: "none" | "renewable";
  readonly #warmResourceCapability?: WarmResourceCapability;

  constructor(options: NetworkedProviderDriverOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#fetch = options.fetch ?? fetch;
    this.#enableLiveStdout = options.enableLiveStdout === true;
    this.#capability = options.capability;
    this.sandboxLifetimeMode = options.enableLifetimeRenewal === true ? "renewable" : "none";
    this.processSupervisionMode = options.enableProcessSupervision === true ? "handle" : "none";
    this.#warmResourceCapability = options.warmResourceCapability;
    this.checkpointMode = options.enableCheckpointRestore === true ? "snapshot" : "none";
    this.advertisedOperations = new Set<ProviderOperation>([
      ...CORE_PROVIDER_OPERATIONS,
      ...(options.enableCheckpointRestore === true ? ["checkpoint", "restore"] as const : []),
    ]);
  }

  /** Refresh only this driver's existing ownership binding. Signature verification
   * remains on the adapter-manager gate for every operation. */
  refreshAuthority(capability: unknown): void {
    const prior = this.#capability;
    const fields = ["organizationId", "targetId", "workerId", "jobId", "attempt", "leaseId", "deviceGeneration"] as const;
    if (!prior || !isValidCapability(capability) || capability.v !== prior.v || capability.audience !== prior.audience ||
        !Number.isSafeInteger(capability.expiresAt) || capability.expiresAt < prior.expiresAt ||
        capability.sig.length === 0 || capability.sig.length > 256 ||
        fields.some((field) => capability.ownedLabels[field] !== prior.ownedLabels[field])) {
      throw new Error("provider authority refresh mismatch");
    }
    this.#capability = { ...capability, ownedLabels: { ...capability.ownedLabels } };
  }

  async deliverBrowserDecision(input: BrowserDecisionDeliveryInput, ctx: ProviderOpContext): Promise<BrowserDecisionDeliveryResult> {
    return decodeBrowserDecisionDelivery(await this.#post("browser_decision", input, ctx, this.#capability));
  }

  async deliverBrowserCredential(input: BrowserCredentialDeliveryInput, ctx: ProviderOpContext): Promise<BrowserCredentialDeliveryResult> {
    return decodeBrowserDecisionDelivery(await this.#post("browser_credential", input, ctx, this.#capability));
  }

  async renewLifetime(sandboxId: string, expiresAt: number, ctx: ProviderOpContext): Promise<SandboxLifetimeResult> {
    if (this.sandboxLifetimeMode !== "renewable") throw new UnsupportedProviderOperation("renew_lifetime");
    if (!Number.isSafeInteger(expiresAt) || !Number.isFinite(ctx.deadlineMs) || ctx.deadlineMs <= 0) throw new WireProtocolError("invalid lifetime renewal");
    const result = await this.#post<unknown>("renew_lifetime", { sandboxId, expiresAt }, ctx, this.#capability);
    if (typeof result !== "object" || result === null || Array.isArray(result)) throw new WireProtocolError("invalid lifetime response");
    const metadata = result as Record<string, unknown>;
    if (typeof metadata.providerOpId !== "string" || metadata.providerOpId.length === 0 || metadata.expiresAt !== expiresAt) {
      throw new WireProtocolError("invalid lifetime response");
    }
    return { providerOpId: metadata.providerOpId, expiresAt };
  }

  async create(spec: CreateSandboxSpec, ctx: ProviderOpContext): Promise<CreateResult> {
    // create is GATE-REQUIRED on a KEYED server (DEP-012 Slice 3 · β1) — attach the
    // owned-labels capability (undefined when the driver was constructed without one;
    // an ungated server ignores it and keeps create's Unit-A byte-identical body, while
    // a gated server refuses on absence with the uniform error). ONE-arg change: `#post`
    // already types `op: ProviderOperation` and threads an optional capability.
    return this.#post<CreateResult>("create", spec, ctx, this.#capability);
  }

  async execute(input: ExecuteInput, ctx: ProviderOpContext): Promise<ExecuteResult> {
    // Driver-owned zero-deadline verdict — the CLIENT short-circuits before the RPC, so
    // the server is never consulted for an exhausted budget (mirrors the provider's own
    // deadlineMs<=0 short-circuit, kept driver-side so the wire preserves it).
    if (ctx.deadlineMs <= 0) {
      return {
        providerOpId: `wire-execute-zero-deadline:${input.sandboxId}`,
        exitCode: null,
        signal: "SIGKILL",
        timedOut: true,
        stdoutRef: `ref:stdout:${input.sandboxId}`,
        stderrRef: `ref:stderr:${input.sandboxId}`,
      };
    }
    // execute is GATE-REQUIRED — attach the owned-labels capability (undefined when the
    // driver was constructed without one; the server then refuses with the uniform error).
    const { onStdout, ...wireInput } = input;
    if (onStdout === undefined) {
      // No stdout channel requested: the pre-WRK-018 body, byte for byte.
      return this.#post<ExecuteResult>("execute", input, ctx, this.#capability);
    }
    if (this.#enableLiveStdout) return this.#executeLive(wireInput, ctx, onStdout);
    // WRK-018 — the stdout channel over the wire: a callback cannot cross HTTP, so ask the
    // adapter-manager to capture (a FLAG, never the function) and replay its returned,
    // already-scrubbed tail into the caller's callback. The tail is stripped from the result
    // so the port's `ExecuteResult` shape is unchanged. A missing or non-string tail (an older
    // adapter-manager, or a garbled body) is "no output", never a failure of the run.
    const raw = await this.#post<ExecuteResult & Record<string, unknown>>(
      "execute",
      { ...wireInput, [EXECUTE_CAPTURE_STDOUT_KEY]: true },
      ctx,
      this.#capability,
    );
    const { [EXECUTE_STDOUT_TAIL_KEY]: tail, ...result } = raw;
    if (typeof tail === "string" && tail.length > 0) onStdout(tail);
    return result as unknown as ExecuteResult;
  }

  // --- the gate-required teardown ops (DEP-012 Unit B2) -----------------------------
  // Each attaches the owned-labels capability and POSTs; the server verifies + owned-checks
  // + dispatches (or refuses with the uniform ResourceNotAvailableError). The results
  // (StopResult/CleanupResult) are NON-sensitive, so they cross byte-identically.

  async cancel(sandboxId: string, ctx: ProviderOpContext): Promise<StopResult> {
    return this.#post<StopResult>("cancel", sandboxId, ctx, this.#capability);
  }
  async kill(sandboxId: string, ctx: ProviderOpContext): Promise<StopResult> {
    return this.#post<StopResult>("kill", sandboxId, ctx, this.#capability);
  }
  async destroy(sandboxId: string, ctx: ProviderOpContext): Promise<CleanupResult> {
    return this.#post<CleanupResult>("destroy", sandboxId, ctx, this.#capability);
  }
  async reconcileCleanup(sandboxId: string, ctx: ProviderOpContext): Promise<CleanupResult> {
    return this.#post<CleanupResult>("reconcile_cleanup", sandboxId, ctx, this.#capability);
  }

  // --- the gate-required redacted reads (DEP-012 Unit B2) ----------------------------
  // The wire carries a REDACTED projection ONLY (hashed labels, no env/secrets/command).
  // The port demands the full InspectResult / ResourceSummary, so the driver SYNTHESIZES a
  // port-shaped result from the caller's OWN labels (cap.ownedLabels — provably equal to
  // the target on the allow path) + the server's projection: resourceLabels from the
  // capability (F2-clean — own labels only), state + generation FROM THE PROJECTION (never
  // invented), and EMPTY sensitive fields. The redacting wire can honor the port no other way.

  async inspect(sandboxId: string, ctx: ProviderOpContext): Promise<InspectResult> {
    const projection = await this.#post<RedactedResourceProjection>("inspect", sandboxId, ctx, this.#capability);
    return this.#synthesizeInspect(projection);
  }

  async list(input: ListInput, ctx: ProviderOpContext): Promise<ListResult> {
    const redacted = await this.#post<RedactedListResult>("list", input, ctx, this.#capability);
    return {
      providerOpId: redacted.providerOpId,
      resources: redacted.resources.map((p) => this.#synthesizeSummary(p)),
      nextPageToken: redacted.nextPageToken,
    };
  }

  async checkpoint(sandboxId: string, ctx: ProviderOpContext): Promise<CheckpointResult> {
    if (this.checkpointMode === "none") throw new UnsupportedProviderOperation("checkpoint");
    const result = await this.#post<unknown>("checkpoint", sandboxId, ctx, this.#capability);
    if (!isRecord(result) || typeof result.providerOpId !== "string" || !result.providerOpId ||
        result.mode !== "snapshot" || typeof result.checkpointRef !== "string" || !result.checkpointRef) {
      throw new WireProtocolError("checkpoint returned a malformed receipt");
    }
    return { providerOpId: result.providerOpId, mode: "snapshot", checkpointRef: result.checkpointRef };
  }
  async restore(sandboxId: string, ctx: ProviderOpContext): Promise<RestoreResult> {
    if (this.checkpointMode === "none") throw new UnsupportedProviderOperation("restore");
    const result = await this.#post<unknown>("restore", sandboxId, ctx, this.#capability);
    if (!isRecord(result) || typeof result.providerOpId !== "string" || !result.providerOpId ||
        typeof result.restored !== "boolean") {
      throw new WireProtocolError("restore returned a malformed receipt");
    }
    return { providerOpId: result.providerOpId, restored: result.restored };
  }
  async health(_sandboxId: string, _ctx: ProviderOpContext): Promise<HealthResult> {
    throw new UnsupportedProviderOperation("health");
  }
  // --- DAT-009-3e — the artifact pair, relayed as gated owned ops ------------------------
  // ONE call is ONE RPC: no retry, no prefetch, no buffering. Whether a result that arrives late
  // is USED is the supervisor's export-window latch (`runExportWindow`, DAT-009-3c: re-checked
  // after every await, so a late digest mints nothing and a late upload is never committed); the
  // driver's part is to issue a call only when asked and to hand back exactly what came back.

  async digestArtifact(sandboxId: string, path: string, ctx: ProviderOpContext): Promise<ArtifactDigestResult> {
    if (this.artifactExportMode === "none") throw new UnsupportedProviderOperation("digest_artifact");
    const result = await this.#post<unknown>("digest_artifact", { sandboxId, path }, ctx, this.#capability);
    // A malformed digest is refused HERE: the sequencer would otherwise mint a grant (a durable
    // row) for a sha256/size the sandbox never produced.
    if (!isDigestResult(result)) throw new WireProtocolError("digest_artifact returned a malformed digest");
    return { sha256: result.sha256, sizeBytes: result.sizeBytes };
  }

  async exportArtifact(
    sandboxId: string,
    path: string,
    grant: ArtifactUploadGrantV1,
    ctx: ProviderOpContext,
  ): Promise<ArtifactExportResult> {
    if (this.artifactExportMode === "none") throw new UnsupportedProviderOperation("export_artifact");
    // GRANT IN (a bearer capability, `redaction:"secret"` — never logged, never in a message),
    // REFERENCE OUT.
    const result = await this.#post<unknown>("export_artifact", { sandboxId, path, grant }, ctx, this.#capability);
    // The only reference a successful export can honestly return is the grant's own key. Anything
    // else — absent, or another key — is refused rather than handed to the fenced commit as if
    // the bytes were there.
    if (!isRecord(result) || result.objectKey !== grant.objectKey) {
      throw new WireProtocolError("export_artifact returned a reference that is not the grant's object key");
    }
    return { objectKey: grant.objectKey };
  }
  /**
   * CLI-012 — the networked lane's METADATA-ONLY enumeration route, which did not exist here.
   *
   * ★ GATE-REQUIRED, exactly like `stage_files` (E7-F011) and the artifact pair: enumeration is
   * a read INTO a live OWNED sandbox, so it attaches the owned-labels capability. An ungated
   * server 404s it.
   *
   * ★ THE RESPONSE IS VALIDATED, NOT TRUSTED. A far side that returned bare strings, an entry
   * without a size, or an entry without a link marker would silently defeat both the `A-O2-4`
   * symlink refusal and the `SD-6` admission bounds on this lane — the producer would see
   * `undefined` where it expects a boolean and a number. A malformed listing is REFUSED here,
   * because a refused export window is recoverable and an exported staged prompt is not.
   */
  async enumerateOutputs(sandboxId: string, root: string, ctx: ProviderOpContext): Promise<EnumerateOutputsResult> {
    if (this.sandboxEnumerationMode === "none") throw new UnsupportedProviderOperation("enumerate_outputs");
    const result = await this.#post<unknown>("enumerate_outputs", { sandboxId, root }, ctx, this.#capability);
    if (!isRecord(result) || !Array.isArray(result.entries)) {
      throw new WireProtocolError("enumerate_outputs returned a malformed listing");
    }
    const entries: SandboxOutputEntry[] = [];
    for (const raw of result.entries) {
      if (
        !isRecord(raw) ||
        typeof raw.path !== "string" ||
        typeof raw.sizeBytes !== "number" ||
        !Number.isFinite(raw.sizeBytes) ||
        raw.sizeBytes < 0 ||
        typeof raw.symlink !== "boolean"
      ) {
        throw new WireProtocolError("enumerate_outputs returned a malformed entry");
      }
      entries.push({ path: raw.path, sizeBytes: raw.sizeBytes, symlink: raw.symlink });
    }
    return { entries };
  }

  /** CLI-012 — this driver relays the metadata-only enumeration above. */
  readonly sandboxEnumerationMode: SandboxEnumerationMode = "metadata";

  async stageFiles(
    sandboxId: string,
    files: readonly StagedFileRequest[],
    ctx: ProviderOpContext,
  ): Promise<StageFilesResult> {
    // E7-F011 — the networked lane's stage_files wire route. GATE-REQUIRED (staging writes
    // into a live OWNED sandbox), so it attaches the owned-labels capability exactly like
    // `execute`; a gated server owned-checks it, an ungated server 404s it. GRANT, NOT BYTES
    // (E4-D01): each `StagedFileRequest` carries an `ArtifactDownloadGrantV1` (a bearer
    // capability, `redaction:"secret"`) and NO payload — the far provider redeems + verifies
    // sha256/maxBytes + writes, so no bytes cross the daemon. Two port params packed into one
    // opaque `args`, as `execute` embeds `sandboxId` in `ExecuteInput`.
    return this.#post<StageFilesResult>("stage_files", { sandboxId, files }, ctx, this.#capability);
  }

  // SVC-008a — a `"none"` provider THROWS from all three; it never returns an
  // observation. A returned `unknown` is indistinguishable at the call site from a
  // transient read failure, whose prescribed response is "escalate and retry" — so a
  // caller that wired up this driver by mistake would retry forever instead of failing
  // at the first call. The throw is unmissable and names the operation.
  async startProcess(input: ExecuteInput, ctx: ProviderOpContext): Promise<ProcessStartResult> {
    if (this.processSupervisionMode === "none") throw new UnsupportedProviderOperation("start_process");
    const { onStdout: _callback, ...metadata } = input;
    return decodeProcessStart(await this.#post("start_process", metadata, ctx, this.#capability));
  }
  async processStatus(
    sandboxId: string,
    handle: ProcessHandle,
    ctx: ProviderOpContext,
  ): Promise<ProcessStatusResult> {
    if (this.processSupervisionMode === "none") throw new UnsupportedProviderOperation("process_status");
    return decodeProcessStatus(await this.#post("process_status", { sandboxId, handle }, ctx, this.#capability));
  }
  async signalProcess(
    sandboxId: string,
    handle: ProcessHandle,
    kind: "cancel" | "kill",
    ctx: ProviderOpContext,
  ): Promise<ProcessSignalResult> {
    if (this.processSupervisionMode === "none") throw new UnsupportedProviderOperation("signal_process");
    return decodeProcessSignal(await this.#post("signal_process", { sandboxId, handle, kind }, ctx, this.#capability));
  }

  async #executeLive(input: Omit<ExecuteInput, "onStdout">, ctx: ProviderOpContext, onStdout: (chunk: string) => void): Promise<ExecuteResult> {
    const response = await this.#fetch(`${this.#baseUrl}/op/execute`, { method: "POST",
      headers: { "content-type": "application/json" },
      body: encodeOpRequest({ ...input, [EXECUTE_CAPTURE_STDOUT_KEY]: true, [EXECUTE_LIVE_STDOUT_KEY]: true },
        ctx, this.#capability, this.#warmResourceCapability),
      signal: AbortSignal.timeout(Math.max(1, Math.ceil(ctx.deadlineMs) + 5000)) });
    // Older peers keep their ordinary JSON response. No retry or second execute.
    if (!response.headers.get("content-type")?.includes("application/x-ndjson")) {
      const raw = decodeOpResponse<Record<string, unknown>>(await response.text());
      const { [EXECUTE_STDOUT_TAIL_KEY]: tail, ...result } = raw;
      if (typeof tail === "string" && tail) onStdout(tail);
      return result as unknown as ExecuteResult;
    }
    if (!response.body) throw new WireProtocolError("missing live execute body");
    const reader = response.body.getReader(); const decoder = new TextDecoder();
    let pending = ""; let bytes = 0; let result: ExecuteResult | undefined;
    const consume = (line: string) => {
      if (result) throw new WireProtocolError("frame after execute result");
      let frame: unknown;
      try { frame = JSON.parse(line); } catch { throw new WireProtocolError("malformed live execute frame"); }
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw new WireProtocolError("malformed live execute frame");
      const record = frame as Record<string, unknown>;
      if (Object.keys(record).length === 1 && typeof record.stdout === "string") {
        if (record.stdout.length > 65536) throw new WireProtocolError("live stdout frame overflow");
        onStdout(record.stdout); return;
      }
      if (Object.keys(record).length !== 1 || (!("ok" in record) && !("err" in record)))
        throw new WireProtocolError("malformed live execute frame");
      result = decodeOpResponse<ExecuteResult>(line);
    };
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) { pending += decoder.decode(); break; }
        bytes += chunk.value.byteLength;
        if (bytes > 2 * 1048576) throw new WireProtocolError("live execute body overflow");
        pending += decoder.decode(chunk.value, { stream: true });
        let end: number;
        while ((end = pending.indexOf("\n")) >= 0) { consume(pending.slice(0, end)); pending = pending.slice(end + 1); }
        if (pending.length > 1048576) throw new WireProtocolError("live execute frame overflow");
      }
      if (pending) consume(pending);
      if (!result) throw new WireProtocolError("live execute ended without result");
      return result;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  async #post<R>(
    // E7-F011 — locally widened beyond the FROZEN `ProviderOperation` vocabulary to carry the
    // non-frozen `stage_files` route (the vocabulary itself is untouched — E4-D02). Additive:
    // every existing caller still passes a `ProviderOperation`. DAT-009-3e widens it the same
    // way, and only locally, for the artifact pair.
    op: ProviderOperation | "stage_files" | "digest_artifact" | "export_artifact" | "enumerate_outputs" | "renew_lifetime" | "start_process" | "process_status" | "signal_process" | "browser_decision" | "browser_credential",
    args: unknown,
    ctx: ProviderOpContext,
    capability?: OwnedLabelsCapability,
  ): Promise<R> {
    const boundedControlOp = op === "browser_credential" || op === "browser_decision" || op === "renew_lifetime" || op === "start_process" || op === "process_status" || op === "signal_process";
    if (boundedControlOp && (!Number.isFinite(ctx.deadlineMs) || ctx.deadlineMs <= 0)) throw new WireProtocolError("exhausted control operation deadline");
    const res = await this.#fetch(`${this.#baseUrl}/op/${op}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: encodeOpRequest(args, ctx, capability, this.#warmResourceCapability),
      ...(boundedControlOp ? { signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(ctx.deadlineMs, 5000)))), ...(ctx.signal ? [ctx.signal] : [])]) } : {}),
    });
    // Body-driven: the codec decides ok vs err vs garbled regardless of HTTP status. A
    // non-JSON / non-envelope body (e.g. a bare 500) surfaces as a WireProtocolError,
    // never as a silent success.
    return decodeOpResponse<R>(await res.text());
  }

  /** The caller's OWN labels, or a fail-closed refusal. Only reached AFTER a successful
   * decode of a gated read — the server refuses (and #post throws) when no capability is
   * carried — so `#capability` is defined here; the guard is defense-in-depth. */
  #ownedLabels(): ResourceLabels {
    if (this.#capability === undefined) throw new ResourceNotAvailableError();
    return this.#capability.ownedLabels;
  }

  /** Reconstruct the port's InspectResult from own labels + the redacted projection.
   * F2-clean: own labels only; state/generation FROM the projection; sensitive fields EMPTY. */
  #synthesizeInspect(projection: RedactedResourceProjection): InspectResult {
    return {
      providerOpId: projection.providerOpId,
      sandboxId: projection.sandboxId,
      resourceLabels: this.#ownedLabels(),
      generation: projection.generation,
      state: projection.state,
      command: "",
      env: {},
      logs: [],
      workspaceBytes: 0,
      objectGrants: [],
      secrets: {},
    };
  }

  /** Reconstruct a port ResourceSummary from own labels + a redacted row. `hasLiveLease`
   * is SYNTHESIZED faithfully (`state === "running"`, matching e2b-provider.ts:308) — never
   * a hardcoded default; no B2 consumer reads it, but a DEP-011 reconcile consumer would.
   * `nextPageToken` (on the ListResult) is whatever the server sent — null for B2's narrow
   * list (the server exposes no cursor; skeptic F1) — passed through, never invented here. */
  #synthesizeSummary(projection: RedactedResourceProjection): ResourceSummary {
    return {
      sandboxId: projection.sandboxId,
      resourceLabels: this.#ownedLabels(),
      generation: projection.generation,
      state: projection.state,
      hasLiveLease: projection.state === "running",
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The port's digest shape, checked structurally: lowercase-hex sha256 (the grant schema's own
 * `sha256DigestSchema` form) and a non-negative integer byte size. */
function isDigestResult(value: unknown): value is ArtifactDigestResult {
  return (
    isRecord(value) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.sizeBytes === "number" &&
    Number.isSafeInteger(value.sizeBytes) &&
    value.sizeBytes >= 0
  );
}
