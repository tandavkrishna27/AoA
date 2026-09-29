import { test } from "node:test";
import assert from "node:assert/strict";

import {
  selectE2bTemplateIdentity,
  evaluateE2bSandboxBuildBinding,
  resolveE2bTemplateIdentity,
  pinnedE2bTemplateSelector,
} from "../m1-provider-identity.mjs";

const BUILD = "12345678-1234-4234-8234-123456789abc";

test("pinned selector names the resolved template and immutable build", () => {
  assert.equal(pinnedE2bTemplateSelector({ templateId: "tpl_immutable", buildId: BUILD }), `tpl_immutable:${BUILD}`);
  for (const bad of [{ templateId: "tpl_immutable" }, { templateId: "tpl_immutable:latest", buildId: BUILD }, { templateId: "", buildId: BUILD }]) {
    assert.throws(() => pinnedE2bTemplateSelector(bad), /exact template and build IDs/);
  }
});

test("selectE2bTemplateIdentity retains the immutable current build and template ids", () => {
  assert.deepEqual(selectE2bTemplateIdentity("aoa-base", [{
    templateID: "tpl_immutable",
    buildID: BUILD,
    names: ["team/aoa-base"],
    aliases: ["aoa-base"],
    buildStatus: "ready",
    envdVersion: "0.2.0",
  }]), {
    requestedTemplate: "aoa-base",
    templateId: "tpl_immutable",
    buildId: BUILD,
    buildStatus: "ready",
    envdVersion: "0.2.0",
  });
});

test("template resolution follows provider pagination before selecting an alias", async () => {
  const urls = [];
  const identity = await resolveE2bTemplateIdentity({
    apiKey: "not-retained",
    requestedTemplate: "aoa-base",
    fetchFn: async (url) => {
      urls.push(url);
      const second = urls.length === 2;
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name === "X-Next-Token" && !second ? "page-2" : null },
        json: async () => second ? [{
          templateID: "tpl",
          buildID: BUILD,
          aliases: ["aoa-base"],
          buildStatus: "ready",
          envdVersion: "0.2.0",
        }] : [],
      };
    },
  });
  assert.equal(identity.buildId, BUILD);
  assert.equal(new URL(urls[0]).pathname, "/templates");
  assert.equal(new URL(urls[1]).pathname, "/templates");
  assert.match(urls[1], /nextToken=page-2/);
});

test("template selection fails closed when the provider runtime version is absent or blank", () => {
  const row = {
    templateID: "tpl",
    buildID: BUILD,
    aliases: ["aoa-base"],
    names: [],
    buildStatus: "ready",
  };
  for (const envdVersion of [undefined, null, "", "   "]) {
    assert.throws(
      () => selectE2bTemplateIdentity("aoa-base", [{ ...row, envdVersion }]),
      /runtime version/i,
    );
  }
});

test("template selection retains the exact meaningful provider runtime version", () => {
  const envdVersion = " 0.2.0 ";
  const identity = selectE2bTemplateIdentity("aoa-base", [{
    templateID: "tpl",
    buildID: BUILD,
    aliases: ["aoa-base"],
    buildStatus: "ready",
    envdVersion,
  }]);
  assert.equal(identity.envdVersion, envdVersion);
});

test("template selection fails closed on no match, ambiguity, non-ready or missing build identity", () => {
  assert.throws(() => selectE2bTemplateIdentity("aoa-base", []), /not resolve/i);
  const row = { templateID: "tpl", buildID: BUILD, aliases: ["aoa-base"], names: [], buildStatus: "ready" };
  assert.throws(() => selectE2bTemplateIdentity("aoa-base", [row, { ...row, templateID: "tpl-2" }]), /ambiguous/i);
  assert.throws(() => selectE2bTemplateIdentity("aoa-base", [{ ...row, buildID: "" }]), /build/i);
  assert.throws(() => selectE2bTemplateIdentity("aoa-base", [{ ...row, buildStatus: "building" }]), /ready/i);
});

test("sandbox build binding requires a provider event for the exact sandbox/template/build", () => {
  const expected = { templateId: "tpl_immutable", buildId: BUILD };
  const event = { sandboxId: "isandbox123456789012", sandboxTemplateId: "tpl_immutable", sandboxBuildId: BUILD };
  assert.deepEqual(evaluateE2bSandboxBuildBinding("isandbox123456789012", expected, [event]), { pass: true, violations: [] });
  assert.equal(evaluateE2bSandboxBuildBinding("isandbox123456789012", expected, []).pass, false);
  assert.equal(evaluateE2bSandboxBuildBinding("isandbox123456789012", expected, [{ ...event, sandboxBuildId: "87654321-4321-4321-8321-cba987654321" }]).pass, false);
  assert.equal(evaluateE2bSandboxBuildBinding("isandbox123456789012", expected, [{ ...event, sandboxTemplateId: "other" }]).pass, false);
});
