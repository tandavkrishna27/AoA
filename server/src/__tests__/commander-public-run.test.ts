import { describe, expect, it } from "vitest";
import { commanderPublicRun } from "../services/commander-public-run.js";
describe("private Commander resource state", () => {
  it("preserves public fields and removes resource authority without mutating the stored row", () => {
    const row = { id: "run", companyId: "company", status: "completed", costCents: 3, distributedWarmConversationId: "private-conversation", distributedWarmState: { resourceId: "private-vm" } };
    expect(commanderPublicRun(row)).toEqual({ id: "run", companyId: "company", status: "completed", costCents: 3 });
    expect(row.distributedWarmState).toEqual({ resourceId: "private-vm" });
  });
  it("keeps legacy rows byte-equivalent", () => {
    const row = { id: "run", distributedWarmState: null };
    expect(commanderPublicRun(row)).toEqual({ id: "run" });
  });
});
