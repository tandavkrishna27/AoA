import type { EffectAuthority } from "./effect-authority.js";
import type { ProviderOpContext } from "./provider.js";

export const BROWSER_APPROVAL_DIRECTORY = "/home/user/.aoa/browser-approvals";
const DECISIONS = new Set(["allow_once", "allow_run", "allow_always", "deny", "cancelled", "expired"]);

// This fixed program executes inside the owned sandbox, never on the worker.
// Publish by rename so the guest cannot observe a partially written response.
const WRITE_RESPONSE = `
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const root = ${JSON.stringify(BROWSER_APPROVAL_DIRECTORY)};
const body = JSON.parse(process.argv[1]);
(async () => {
  const metadata = await fs.lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await fs.realpath(root) !== root) throw Error('unsafe approval directory');
  if (!(Date.parse(body.expiresAt) > Date.now())) throw Error('expired approval');
  const temporary = root + '/.' + crypto.randomUUID() + '.tmp';
  const target = root + '/' + body.requestId + '.json';
  try {
    const file = await fs.open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(body)); } finally { await file.close(); }
    if (!(Date.parse(body.expiresAt) > Date.now())) throw Error('expired approval');
    await fs.rename(temporary, target);
  } finally { await fs.unlink(temporary).catch(() => {}); }
})().catch(() => { process.exitCode = 1; });
`;

/** A matched control decision crosses only as metadata. The provider's regular
 * execute gate checks the owned sandbox capability; the local effect authority
 * refuses writes after lease loss or cancellation. */
export async function deliverBrowserApproval(input: {
  effect: Pick<EffectAuthority, "execute">;
  sandboxId: string;
  response: { requestId: string; decision: string; expiresAt: string };
  now(): number;
  ctx: ProviderOpContext;
}): Promise<void> {
  const { response } = input;
  const remainingMs = Date.parse(response.expiresAt) - input.now();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(response.requestId) ||
      !DECISIONS.has(response.decision) || !Number.isFinite(remainingMs) || remainingMs <= 0 || input.ctx.deadlineMs <= 0) {
    throw new Error("invalid browser approval response");
  }
  const result = await input.effect.execute({ sandboxId: input.sandboxId, command: "node",
    args: ["-e", WRITE_RESPONSE, JSON.stringify({ requestId: response.requestId, decision: response.decision, expiresAt: response.expiresAt })], env: {} },
  { ...input.ctx, deadlineMs: Math.min(input.ctx.deadlineMs, remainingMs, 5000) });
  if (result.exitCode !== 0 || result.timedOut || result.signal !== null) throw new Error("browser approval write failed");
}
