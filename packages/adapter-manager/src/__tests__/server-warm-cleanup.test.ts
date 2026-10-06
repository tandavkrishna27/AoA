import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { NetworkedProviderDriver, signOwnedLabelsCapability } from "@armyofagents/provider-wire";
import { createFakeSandboxProvider } from "../../../worker-daemon/src/__tests__/support/fake-provider.js";
import { createProviderServer } from "../server.js";
import { WarmCleanupJournal } from "../warm-cleanup-journal.js";
const labels = { organizationId: "org", targetId: "target", workerId: "worker", jobId: "job", attempt: 1, leaseId: "lease", deviceGeneration: 1 };
const warmSpec = { resourceLabels: labels, command: "node", args: ["/home/user/aoa-commander-warm-v1.cjs", "codex",
  "/home/user/aoa-commander-input.json", "/home/user/aoa-output/aoa-one-shot-result.json"], env: {}, workloadType: "commander_turn" };
const ctx = { deadlineMs: 5000, idempotencyKey: "create" };
const servers: ReturnType<typeof createProviderServer>[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } });
async function setup(options: { journal?: boolean; snapshot?: boolean } = {}) {
  const keys = generateKeyPairSync("ed25519");
  const provider = createFakeSandboxProvider({ optionalOperations: ["checkpoint", "restore"], checkpointMode: options.snapshot === false ? "none" : "snapshot" });
  const dir = mkdtempSync(join(tmpdir(), "aoa-am-warm-wire-")); const journal = new WarmCleanupJournal(join(dir, "cleanup"));
  const server = createProviderServer({ provider, controlPlanePublicKey: keys.publicKey, idempotencyLedgerDir: join(dir, "create"),
    isWarmEnabled: () => true,
    ...(options.journal === false ? {} : { warmCleanupJournal: journal }) });
  servers.push(server); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const capability = signOwnedLabelsCapability({ v: 1, audience: "adapter-manager", ownedLabels: labels, expiresAt: Date.now() + 60000 }, keys.privateKey);
  return { provider, journal, driver: new NetworkedProviderDriver({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, capability }) };
}
describe("warm registration and cleanup across signed HTTP", () => {
  it.each([{ journal: false }, { snapshot: false }])("refuses warm creation before effects when lifecycle support is absent: %j", async (options) => {
    const run = await setup(options);
    await expect(run.driver.create(warmSpec, ctx)).rejects.toThrow();
    expect(run.provider.callCount("create")).toBe(0);
  });
  it("registers exact physical labels before create returns and journals worker destroy", async () => {
    const run = await setup(); const created = await run.driver.create(warmSpec, ctx);
    expect(run.journal.isRegistered(created.sandboxId, labels)).toBe(true);
    expect(run.journal.pending()).toEqual([]);
    await run.driver.destroy(created.sandboxId, { ...ctx, idempotencyKey: "destroy" });
    expect(run.journal.pending()).toEqual([{ resourceId: created.sandboxId, physicalLabels: labels,
      status: "confirmed", providerOpId: expect.any(String) }]);
  });
  it("preserves ordinary ephemeral create and destroy without cleanup entries", async () => {
    const run = await setup(); const created = await run.driver.create({ ...warmSpec, command: "node", args: ["ordinary.js"] }, ctx);
    await run.driver.destroy(created.sandboxId, { ...ctx, idempotencyKey: "destroy" });
    expect(run.journal.isRegistered(created.sandboxId, labels)).toBe(false); expect(run.journal.pending()).toEqual([]);
  });
});
