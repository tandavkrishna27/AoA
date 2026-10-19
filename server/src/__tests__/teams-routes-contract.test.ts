import { describe, expect, it, vi } from "vitest";

const makeService = () => new Proxy({}, { get: () => vi.fn() });

vi.mock("../services/index.js", () => ({
  teamCoordinationService: vi.fn(() => makeService()),
  teamExportService: vi.fn(() => makeService()),
  teamScaffolderService: vi.fn(() => makeService()),
  teamsService: vi.fn(() => makeService()),
}));

// Slice 1 / Task 1.10: contract tests for the new teamsRoutes(db) factory.
//
// IMPORTANT naming note: there is a pre-existing `teamRoutes` (singular)
// export at `server/src/routes/team.ts` for the user/board permissions
// domain. The new departmental-teams routes use the plural name
// `teamsRoutes` to disambiguate. Same disambiguation applies to the
// validation schemas (`addTeamsMemberSchema`, `updateTeamsMemberRoleSchema`).
describe("teamsRoutes — conformance + contract", () => {
  it("exports a factory function (not a top-level Router)", async () => {
    const startedAt = performance.now();
    const mod = await import("../routes/teams.js");
    const importMs = performance.now() - startedAt;
    // Import-speed qualification is deferred during implementation. Completion
    // and the factory contract remain mandatory under the normal test timeout.
    // Windows timing remains unqualified even when performance QA is enabled.
    if (process.env.AOA_RUN_PERFORMANCE_QA === "1" && process.platform !== "win32") {
      expect(importMs).toBeLessThan(3000);
    }
    expect(typeof mod.teamsRoutes).toBe("function");
    expect(mod.teamsRoutes.length).toBe(1); // accepts (db) param
  });

  it("returns an Express Router when called with db", async () => {
    const { teamsRoutes } = await import("../routes/teams.js");
    const fakeDb = {} as unknown as never;
    const router = teamsRoutes(fakeDb);
    expect(router).toBeDefined();
    expect(typeof router).toBe("function"); // Express Routers are functions
    expect((router as unknown as { stack: unknown[] }).stack).toBeInstanceOf(Array);
  });
});
