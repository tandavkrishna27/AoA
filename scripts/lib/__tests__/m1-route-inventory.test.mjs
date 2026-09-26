import assert from "node:assert/strict";
import test from "node:test";

import { evaluateM1FreezeExclusions, observeFreezeTopology } from "../m1-shipped-boot.mjs";

test("freeze topology observes desktop services and mounted cross-target handoff routes", () => {
  const topology = observeFreezeTopology({
    renderedServices: { "desktop-host": {}, "control-plane": {} },
    runningServices: ["control-plane"],
    runningControlPlanes: 1,
    routeRegistrySource: 'import { crossTargetHandoffRoutes } from "./routes/handoff.js";\napi.use(\n  crossTargetHandoffRoutes({ db }),\n);',
  });
  assert.deepEqual(topology.desktopServices, ["desktop-host"]);
  assert.ok(topology.crossTargetMobilityRoutes.includes("crossTargetHandoffRoutes"));
  assert.deepEqual(topology.inventoryViolations, []);
  assert.equal(topology.runningControlPlanes, 1);
});

test("freeze route inventory resolves app mounts, aliases, and dynamic imports", () => {
  for (const routeRegistrySource of [
    'import { crossTargetHandoffRoutes } from "./routes/handoff.js"; app.use(crossTargetHandoffRoutes());',
    'import { crossTargetHandoffRoutes as routes } from "./routes/handoff.js"; app.use(routes());',
    'import { crossTargetHandoffRoutes } from "./routes/handoff.js"; const mobilityRouter = crossTargetHandoffRoutes(); api.use(mobilityRouter);',
    'const { crossTargetHandoffRoutes } = await import("./routes/handoff.js"); api.use(crossTargetHandoffRoutes());',
    'const { crossTargetHandoffRoutes: routes } = await import("./routes/handoff.js"); api.use(routes());',
    'import routes from "./routes/cross-target-handoff.js"; app.use(routes());',
    'const mod = await import("./routes/cross-target-handoff.js"); api.use(mod.routes());',
    'import { crossTargetHandoffRoutes } from "./routes/handoff.js"; let r; r = crossTargetHandoffRoutes(); api.use(r);',
  ]) {
    const topology = observeFreezeTopology({ routeRegistrySource });
    assert.ok(topology.crossTargetMobilityRoutes.length > 0, routeRegistrySource);
    assert.deepEqual(topology.inventoryViolations, []);
  }
});

test("freeze route inventory fails closed on unsupported mobility registration grammar", () => {
  const topology = observeFreezeTopology({ routeRegistrySource: "api.use(buildRouter(crossTargetHandoffRoutes));" });
  assert.ok(topology.crossTargetMobilityRoutes.includes("crossTargetHandoffRoutes"));
  assert.equal(topology.inventoryViolations.length, 1);
  const result = evaluateM1FreezeExclusions({
    env: {},
    rolloutValue: JSON.stringify({ organizations: {} }),
    expectedTenants: { enabled: [], control: null },
    topology,
  });
  assert.ok(result.violations.some((v) => v.includes("unsupported mobility route mount grammar")));

  const aliased = observeFreezeTopology({
    routeRegistrySource: 'import { crossTargetHandoffRoutes as routes } from "./routes/handoff.js"; api.use(buildRouter(routes));',
  });
  assert.equal(aliased.inventoryViolations.length, 1);

  const namespaced = observeFreezeTopology({
    routeRegistrySource: 'const mod = await import("./routes/cross-target-handoff.js"); api.use(buildRouter(mod.routes));',
  });
  assert.equal(namespaced.inventoryViolations.length, 1);
});

test("freeze route inventory does not classify an unrelated generic mount as mobility", () => {
  const topology = observeFreezeTopology({
    routeRegistrySource: 'import routes from "./routes/health.js"; api.use(routes());',
  });
  assert.deepEqual(topology.crossTargetMobilityRoutes, []);
  assert.deepEqual(topology.inventoryViolations, []);
});

test("freeze route inventory blocks indirect and unused mobility references globally", () => {
  for (const routeRegistrySource of [
    'import { crossTargetHandoffRoutes } from "./routes/handoff.js"; const mounted = [crossTargetHandoffRoutes()]; api.use(...mounted);',
    'import { crossTargetHandoffRoutes } from "./routes/handoff.js"; const make = () => crossTargetHandoffRoutes(); api.use(make());',
    'const p = import("./routes/cross-target-handoff.js"); const mod = await p; api.use(mod.routes());',
    'import { crossTargetHandoffRoutes } from "./routes/handoff.js";',
    'const modulePromise = import("./routes/cross-target-handoff.js");',
  ]) {
    const topology = observeFreezeTopology({ routeRegistrySource });
    assert.ok(topology.crossTargetMobilityRoutes.length > 0, routeRegistrySource);
  }
});

test("freeze route inventory ignores mobility prose in comments and ordinary strings", () => {
  const topology = observeFreezeTopology({
    routeRegistrySource: '// cross-target handoff remains disabled\nconst note = "mobility route is absent"; api.use(healthRoutes());',
  });
  assert.deepEqual(topology.crossTargetMobilityRoutes, []);
  assert.deepEqual(topology.inventoryViolations, []);
});
