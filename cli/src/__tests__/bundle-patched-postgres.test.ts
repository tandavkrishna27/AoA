import { expect, it } from "vitest";

it("bundles the patched PostgreSQL driver so npm CLI users retain COPY error handling", async () => {
  const { default: config } = await import(new URL("../../esbuild.config.mjs", import.meta.url).href);
  expect(config.bundle).toBe(true);
  expect(config.external).not.toContain("postgres");
  expect(config.external).toContain("@armyofagents/server");
});
