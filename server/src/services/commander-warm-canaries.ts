import { z } from "zod";
import { localEncryptedProvider } from "../secrets/local-encrypted-provider.js";
import type { SecretProviderModule } from "../secrets/types.js";

export const commanderWarmCanaryMaterialSchema = z.object({ scheme: z.literal("local_encrypted_v1"),
  iv: z.string().min(1).max(64), tag: z.string().min(1).max(64), ciphertext: z.string().min(1).max(262144) }).strict();
export type CommanderWarmCanaryMaterial = z.infer<typeof commanderWarmCanaryMaterialSchema>;
export interface CommanderWarmCanaryIdentity {
  organizationId: string; companyId: string; userId: string; conversationId: string; id: string; generation: number;
}
const payloadSchema = z.object({ version: z.literal(1), organizationId: z.string().min(1).max(256),
  companyId: z.string().min(1).max(256), userId: z.string().min(1).max(256), conversationId: z.string().min(1).max(256),
  sessionId: z.string().min(1).max(256), generation: z.number().int().positive().safe(), values: z.array(z.string().min(1)).max(64) }).strict();
export class CommanderWarmCanaryError extends Error {
  constructor() { super("Commander warm redaction history unavailable"); this.name = "CommanderWarmCanaryError"; }
}
export function mergeCommanderWarmCanaries(...sets: readonly (readonly string[])[]): string[] {
  const values = new Set<string>();
  let bytes = 0;
  for (const set of sets) for (const value of set) {
    if (typeof value !== "string" || !value) throw new CommanderWarmCanaryError();
    if (values.has(value)) continue;
    bytes += Buffer.byteLength(value, "utf8"); values.add(value);
    if (values.size > 64 || bytes > 65536) throw new CommanderWarmCanaryError();
  }
  return [...values];
}
export interface CommanderWarmCanaryVault {
  seal(identity: CommanderWarmCanaryIdentity, values: readonly string[]): Promise<CommanderWarmCanaryMaterial>;
  open(identity: CommanderWarmCanaryIdentity, material: CommanderWarmCanaryMaterial): Promise<string[]>;
}
/** Uses the existing encrypted secret provider. Scope is inside the authenticated
 * ciphertext, so copying a blob between tenants, users or sessions cannot widen
 * the redaction history. Never persists plaintext values or a secret hash. */
export function createCommanderWarmCanaryVault(provider: SecretProviderModule = localEncryptedProvider): CommanderWarmCanaryVault {
  return {
    async seal(identity, values) {
      try {
        const payload = payloadSchema.parse({ version: 1, organizationId: identity.organizationId, companyId: identity.companyId,
          userId: identity.userId, conversationId: identity.conversationId, sessionId: identity.id,
          generation: identity.generation, values: mergeCommanderWarmCanaries(values) });
        const prepared = await provider.createVersion({ value: JSON.stringify(payload), externalRef: null,
          context: { companyId: identity.companyId, secretKey: "commander-warm:" + identity.id,
            secretName: "Commander warm redaction history", version: identity.generation } });
        return commanderWarmCanaryMaterialSchema.parse(prepared.material);
      } catch { throw new CommanderWarmCanaryError(); }
    },
    async open(identity, material) {
      try {
        const checked = commanderWarmCanaryMaterialSchema.parse(material);
        const value = await provider.resolveVersion({ material: checked, externalRef: null });
        const payload = payloadSchema.parse(JSON.parse(value));
        if (payload.organizationId !== identity.organizationId || payload.companyId !== identity.companyId ||
            payload.userId !== identity.userId || payload.conversationId !== identity.conversationId ||
            payload.sessionId !== identity.id || payload.generation > identity.generation) throw new CommanderWarmCanaryError();
        return mergeCommanderWarmCanaries(payload.values);
      } catch { throw new CommanderWarmCanaryError(); }
    },
  };
}
