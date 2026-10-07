import { expect, it } from "vitest";
import { OWNED_LABELS_CAPABILITY_EXTENSION_NAMESPACE as SERVER_NAMESPACE } from "../services/owned-labels-mint.js";
import { OWNED_LABELS_CAPABILITY_EXTENSION_NAMESPACE as WORKER_NAMESPACE } from "../../../packages/worker-daemon/src/lease/renewed-owned-labels-capability.js";

it("pins the renewed capability namespace across server and worker", () => {
  expect(WORKER_NAMESPACE).toBe(SERVER_NAMESPACE);
});
