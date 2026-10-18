export const type = "codex_local";
export const label = "Codex (local)";
export const SANDBOX_INSTALL_COMMAND = "npm install -g @openai/codex";
/** Empty means inherit the default from the active Codex CLI account catalog. */
export const DEFAULT_CODEX_LOCAL_MODEL = "";
export const DEFAULT_CODEX_LOCAL_BYPASS_APPROVALS_AND_SANDBOX = true;

export const CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS = ["gpt-5.4"] as const;

export function isCodexLocalFastModeSupported(model: string | null | undefined): boolean {
  if (!model) return false;
  return (CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS as readonly string[]).includes(model);
}

// Model choices are loaded from the active CLI's model/list catalog. Do not
// maintain a static list here: bundled slugs can be retired or incompatible.
export const models: Array<{ id: string; label: string }> = [];

export const agentConfigurationDoc = `# codex_local agent configuration

Adapter: codex_local

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to stdin prompt at runtime
- model (string, optional): Codex model id
- modelReasoningEffort (string, optional): reasoning effort override (minimal|low|medium|high) passed via -c model_reasoning_effort=...
- promptTemplate (string, optional): run prompt template
- search (boolean, optional): run codex with --search
- dangerouslyBypassApprovalsAndSandbox (boolean, optional): run with bypass flag
- command (string, optional): defaults to "codex"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- Prompts are piped via stdin (Codex receives "-" prompt argument).
- Paperclip auto-injects local skills into Codex personal skills dir ("$CODEX_HOME/skills" or "~/.codex/skills") when missing, so Codex can discover "$paperclip" and related skills.
- Some model/tool combinations reject certain effort levels (for example minimal with web search enabled).
- fastMode (boolean, optional): enable Codex Fast tier for lower-latency runs. Currently supported on gpt-5.4 only; ignored on other models. Consumes credits faster.
`;
