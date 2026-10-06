import { describe, expect, it } from "vitest";
import { oneShotOperationId } from "../services/one-shot-operation-identity.js";
const input = { companyId: "company", operationIdentity: "entry", source: "extraction", cliTool: "codex", command: "codex", args: ["exec"], stdinContent: "same input", timeoutMs: 30_000 };
describe("durable one-shot operation identity", () => {
  it("rejoins the same operation after a caller restart", () => { expect(oneShotOperationId(input)).toBe(oneShotOperationId({ ...input })); });
  it.each([{ companyId: "other" }, { operationIdentity: "other-entry" }, { stdinContent: "new content" }, { args: ["exec", "--model", "other"] }, { timeoutMs: 20_000 }])("does not reuse changed authority/input %j", (change) => { expect(oneShotOperationId({ ...input, ...change })).not.toBe(oneShotOperationId(input)); });
  it("keeps stateless operations independent", () => { expect(oneShotOperationId({ ...input, operationIdentity: undefined })).not.toBe(oneShotOperationId({ ...input, operationIdentity: undefined })); });
});
