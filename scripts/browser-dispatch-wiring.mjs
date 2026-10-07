import { readFileSync } from 'node:fs';
import path from 'node:path';

// E8-F006: staged execution has no host import of runBrowserSession. Check the
// explicit production composition instead. This is a structural regression guard,
// not runtime conformance, provider enforcement, or a general reachability proof.
export const BROWSER_DISPATCH_LINKS = Object.freeze([
  ['bundle-entry', 'server/src/services/browser-runtime-bundle.ts', 'createRequire(import.meta.url).resolve("@armyofagents/browser-runtime/runner")'],
  ['bundle-output', 'server/src/services/browser-runtime-bundle.ts', '{ path: BROWSER_RUNNER_PATH, bytes, contentType: "application/javascript" }'],
  ['request-bundle', 'server/src/services/agent-browser-request.ts', 'const files = await browserRuntimeInputFiles(prepared.config);'],
  ['request-stage', 'server/src/services/agent-browser-request.ts', 'await stageJobInputFiles({ appDb: input.appDb, storage: input.storage, organizationId, companyId: actor.companyId, jobId: prepared.response.jobId, attemptId: prepared.response.attemptId, files });'],
  ['lease-staged-paths', 'server/src/services/job-leasing.ts', '![BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH, `${BROWSER_RUNTIME_ROOT}/package.json`].every((path) => input.stagedInput.some((file) => file.path === path))'],
  ['lease-dispatch-extension', 'server/src/services/job-leasing.ts', 'browserDispatchExtension(browserPreparation)'],
  ['runtime-supervisor-constructor', 'packages/worker-daemon/src/lifecycle/dispatch-runtime.ts', 'const makeSupervisor = deps.makeSupervisor ?? createSupervisor;'],
  ['runtime-supervisor-call', 'packages/worker-daemon/src/lifecycle/dispatch-runtime.ts', 'const supervisor = makeSupervisor({'],
  ['runtime-staging-resolver', 'packages/worker-daemon/src/lifecycle/dispatch-runtime.ts', 'const resolveStagedFiles = createStagedInputResolver({'],
  ['runtime-staging-port', 'packages/worker-daemon/src/lifecycle/dispatch-runtime.ts', 'resolveStagedFiles,'],
  ['runtime-poll-seam', 'packages/worker-daemon/src/lifecycle/dispatch-runtime.ts', 'supervisor: driver,'],
  ['runtime-renewal-seam', 'packages/worker-daemon/src/lifecycle/dispatch-runtime.ts', 'identity,\n    supervisor,\n    schedule: makeSchedule(),'],
  ['runtime-self-model', 'packages/worker-daemon/src/lifecycle/dispatch-runtime.ts', 'browserSelfModel: deps.self,'],
  ['supervisor-browser-branch', 'packages/worker-daemon/src/supervisor/supervisor.ts', 'if (handoff.offer.job.workloadType === "browser_session") {\n      const self = deps.browserSelfModel;'],
  ['supervisor-target-ceiling', 'packages/worker-daemon/src/supervisor/supervisor.ts', 'const verified = !!self && self.registeredTargetProfile.capabilityCeiling.includes("sandbox.filtered_egress") &&'],
  ['supervisor-reported-ceiling', 'packages/worker-daemon/src/supervisor/supervisor.ts', 'self.report.reportedCapabilities.includes("sandbox.filtered_egress") &&'],
  ['supervisor-profile-identity', 'packages/worker-daemon/src/supervisor/supervisor.ts', 'self.registeredTargetProfile.providerConstraints.profileId === self.verifiedProviderConstraints.profileId &&\n        self.registeredTargetProfile.providerConstraints.version === self.verifiedProviderConstraints.version &&\n        self.registeredTargetProfile.providerConstraints.digest === self.verifiedProviderConstraints.digest;'],
  ['supervisor-refusal-branch', 'packages/worker-daemon/src/supervisor/supervisor.ts', 'if (refusal !== null) {\n        await events.terminal({ status: "failed", exitCode: null, errorCode: refusal, errorMessage: null });'],
  ['supervisor-dispatch-refusal', 'packages/worker-daemon/src/supervisor/supervisor.ts', 'const refusal = browserDispatchRefusal(handoff, verified);'],
  ['supervisor-policy-branch', 'packages/worker-daemon/src/supervisor/supervisor.ts', 'if (browserPolicy) {\n      if (!run.effect.supportsBrowserNetworkPolicy() || !deps.resolveStagedFiles) {'],
  ['supervisor-provider-gate', 'packages/worker-daemon/src/supervisor/supervisor.ts', 'if (!run.effect.supportsBrowserNetworkPolicy() || !deps.resolveStagedFiles) {'],
  ['supervisor-fixed-runner', 'packages/worker-daemon/src/supervisor/supervisor.ts', 'command: "node", args: [BROWSER_RUNNER_PATH, BROWSER_CONFIG_PATH]'],
  ['supervisor-execute-fixed-spec', 'packages/worker-daemon/src/supervisor/supervisor.ts', 'run.effect.execute(\n          {\n            sandboxId: created.sandboxId,\n            command: spec.command,\n            args: spec.args,'],
  ['supervisor-stage-call', 'packages/worker-daemon/src/supervisor/supervisor.ts', 'run.effect.stageFiles(created.sandboxId, staged, run.makeCtx())'],
  ['dispatch-policy-refusal', 'packages/worker-daemon/src/supervisor/browser-dispatch.ts', 'if (!readBrowserNetworkPolicy(handoff)) return "browser_network_policy_invalid";'],
  ['provider-verified-marker', 'packages/worker-daemon/src/supervisor/effect-authority.ts', 'return this.#provider.browserNetworkPolicyMode === "verified_default_deny";'],
  ['hello-capability-intersection', 'packages/worker-daemon/src/enrollment/hello-provisioning.ts', 'const reportedCapabilities = parsed.data.capabilityCeiling.filter((cap) => deviceCanProvide.has(cap));'],
  ['guest-session-call', 'packages/browser-runtime/src/runner.ts', 'return await runBrowserSession(config, {'],
].map(([id, file, code]) => Object.freeze({ id, file, code })));

// Dependency-free policy lexer. Literals (including templates and regexes) stay
// single tokens, so their contents cannot impersonate executable composition.
// This is deliberately a bounded lexical guard, not a TypeScript semantic parser.
function tokens(source) {
  const result = [];
  let i = 0;
  function slashLiteral() {
    const start = i++;
    let inClass = false;
    while (i < source.length && !/[\r\n]/.test(source[i])) {
      if (source[i] === "\\") { i += 2; continue; }
      if (source[i] === '[') inClass = true;
      else if (source[i] === ']') inClass = false;
      else if (source[i] === '/' && !inClass) {
        i++;
        while (i < source.length && /[a-z]/i.test(source[i])) i++;
        return source.slice(start, i);
      }
      i++;
    }
    i = start + 1;
    return null;
  }
  function comment() {
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i + 2); i = end < 0 ? source.length : end; return true;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new Error('unterminated comment');
      i = end + 2; return true;
    }
    return false;
  }
  function quoted(quote) {
    const start = i++;
    while (i < source.length) {
      if (source[i] === "\\") { i += 2; continue; }
      if (source[i] === quote) { i++; return source.slice(start, i); }
      if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
        i += 2;
        let depth = 1;
        while (i < source.length && depth) {
          if (comment()) continue;
          if (source[i] === '/') { slashLiteral(); continue; }
          if (source[i] === '"' || source[i] === "'" || source[i] === '`') quoted(source[i]);
          else if (source[i] === '{') { depth++; i++; }
          else if (source[i] === '}') { depth--; i++; }
          else if (source[i] === "\\") i += 2;
          else i++;
        }
        if (depth) throw new Error('unterminated template');
        continue;
      }
      if (quote !== '`' && /[\r\n]/.test(source[i])) throw new Error('unterminated string');
      i++;
    }
    throw new Error('unterminated literal');
  }
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (comment()) continue;
    if (ch === '"' || ch === "'" || ch === '`') { result.push('literal:' + quoted(ch)); continue; }
    // Conservatively treat a same-line slash pair as opaque in any expression
    // position. This can hide a division expression (and refuse a link), but
    // never makes regex prose count as executable code after e.g. if (...).
    if (ch === '/') {
      const literal = slashLiteral();
      result.push(literal === null ? 'punct:/' : 'regex:' + literal); continue;
    }
    if (/[A-Za-z0-9_$]/.test(ch)) {
      const start = i++;
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) i++;
      result.push('word:' + source.slice(start, i)); continue;
    }
    result.push('punct:' + ch); i++;
  }
  return result;
}

function contains(source, expected) {
  return source.some((_, offset) => expected.every((token, index) => source[offset + index] === token));
}
export function inspectBrowserDispatchComposition(root) {
  const sources = new Map();
  return BROWSER_DISPATCH_LINKS.filter(link => {
    if (!sources.has(link.file)) {
      try { sources.set(link.file, tokens(readFileSync(path.join(root, link.file), 'utf8'))); }
      catch { sources.set(link.file, []); }
    }
    return !contains(sources.get(link.file), tokens(link.code));
  }).map(({ id, file }) => ({ id, file }));
}
