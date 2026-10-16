import { test, expect } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";
import {
  cleanupTestCompanies,
  seedConfiguredCompany,
} from "./helpers/seed-company";

/**
 * provider-switching.spec.ts  (Unit 11 — Part C, Layer 3 e2e)
 *
 * SAVE-SIDE behavior of the agent-config UI for the provider-switching engine.
 *
 * Lower layers (locally green / Linux-CI green):
 *   - Pure/contract:  server/src/__tests__/provider-switching-parity.test.ts
 *   - Integration:    server/src/__tests__/provider-switching.integration.test.ts
 *
 * This Playwright layer drives the real agent-config form (codex_local) and
 * the request-only validation gates. On CI Linux this is a required e2e gate;
 * on Windows the playwright config skips ALL specs (embedded-postgres can't
 * boot on the runner), so locally this only confirms the suite COLLECTS.
 *
 * Company-creation mirrors onboarding-thread-pipeline.spec.ts (drives the
 * wizard through Step 4, which is the step that actually POSTs /companies).
 * Agents are seeded directly via the API because the wizard's Step 5 needs a
 * real local adapter CLI to advance.
 */

/**
 * Seed a codex_local agent via the API. In local_trusted mode the synthetic
 * local-board actor is auto-authorised, so no Bearer token is needed.
 *
 * Pass `model` only for the explicit-selection cases. Omitting it persists a
 * blank inherited model so execution resolves the selected account's catalog.
 */
async function seedCodexAgent(
  request: APIRequestContext,
  companyId: string,
  model?: string,
): Promise<string> {
  const adapterConfig = model ? { model } : {};
  const res = await request.post(`/api/companies/${companyId}/agents`, {
    data: {
      name: "PS Codex Worker",
      adapterType: "codex_local",
      adapterConfig,
    },
  });
  if (res.status() !== 201) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(`seedCodexAgent failed: ${res.status()} ${body}`);
  }
  const agent = (await res.json()) as { id: string };
  if (!agent.id) {
    throw new Error(`seedCodexAgent returned no id: ${JSON.stringify(agent)}`);
  }
  return agent.id;
}

/**
 * Fetch the AoA CREW agents (the worker agents seeded at company create) via the
 * existing list endpoint. `routes/agents.ts` GET /companies/:id/agents returns a
 * BARE ARRAY (res.json(result) where result = svc.list(...)), each row carrying
 * `name` + `adapterType`. We tolerate a `{ agents: [...] }` envelope defensively,
 * but the real shape today is a bare array. In local_trusted the e2e runs as the
 * `board` actor, so configs are unredacted.
 *
 * IMPORTANT: the kind="aoa" set includes the COMMANDER row, which follows the
 * Commander cliTool (resolveCommanderAdapterForCompany), NOT the crew provider —
 * so on an anthropic-commander + openai-crew company Commander is claude_local
 * while the crew is codex_local. The provider-switch behavior under test is about
 * the CREW, so we exclude Commander by name here.
 */
async function getAoaCrew(
  request: APIRequestContext,
  companyId: string,
): Promise<
  Array<{ name: string; adapterType: string; adapterConfig?: Record<string, unknown> }>
> {
  const res = await request.get(
    `/api/companies/${companyId}/agents?kind=aoa`,
  );
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as
    | Array<{ name: string; adapterType: string; adapterConfig?: Record<string, unknown> }>
    | { agents: Array<{ name: string; adapterType: string; adapterConfig?: Record<string, unknown> }> };
  const rows = Array.isArray(body) ? body : body.agents;
  // Commander follows its own cliTool, not the crew provider — exclude it.
  // In local_trusted the e2e runs as the `board` actor, so adapterConfig is
  // returned UNREDACTED (the list handler returns the raw rows for board/config
  // readers; only restricted actors get an empty adapterConfig). model is not a
  // secret, so adapterConfig.model survives for the model-only assertions below.
  return rows.filter((a) => a.name !== "Commander");
}

/**
 * Navigate to Settings → Commander → "Execution & Model" sub-tab, where the AoA
 * crew-provider picker lives. The real route is a query-param tab on the company
 * settings page (`/:prefix/settings?tab=commander&sub=execution`); `execution`
 * is the default sub-tab. The crew-provider control is a Radix Select whose
 * trigger carries `aria-label="Crew provider"`, so getByLabel(/crew provider/i)
 * resolves it. (It is NOT a native <select>, so callers must open the trigger and
 * click the option rather than using selectOption.)
 */
async function openCommanderExecutionTab(
  page: Page,
  companyPrefix: string,
): Promise<void> {
  await page.goto(
    `/${companyPrefix}/settings?tab=commander&sub=execution`,
  );
  await page.getByLabel(/crew provider/i).waitFor();
}

test.describe("provider-switching: agent config save-side", () => {
  test.beforeEach(async ({ request }) => {
    await cleanupTestCompanies(request, /^E2E-PS-/);
  });

  test("codex model picker inherits the account default and requests the agent-scoped catalog", async ({
    page,
    request,
  }) => {
    const { companyId, issuePrefix } = await seedConfiguredCompany(request, {
      companyName: `E2E-PS-${Date.now()}`,
    });
    const agentId = await seedCodexAgent(request, companyId);
    const modelRequest = page.waitForRequest((req) => {
      const url = new URL(req.url());
      return url.pathname === `/api/companies/${companyId}/adapters/codex_local/models`
        && url.searchParams.get("agentId") === agentId;
    });

    await page.goto(`/${issuePrefix}/agents/${agentId}/configure`);

    // The redesigned config page uses a section rail; the model picker lives in
    // the "Permissions & config" section — select it (its content is expanded by
    // default in the edit layout).
    await page
      .getByRole("button", { name: "Permissions & config" })
      .click();

    // This isolated agent has no per-agent auth.json, so its picker has no
    // listed models. The form still makes account-default inheritance clear.
    const trigger = page.getByRole("button", { name: "Account default (Codex CLI)", exact: true });
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await modelRequest;

    await trigger.click();
    await expect(
      page.getByRole("button", { name: "Account default (Codex CLI)", exact: true }),
    ).toHaveCount(2);
    await expect(page.getByRole("button", { name: /^gpt-5\.5$/i })).toHaveCount(0);
  });

  test("saving an explicit Codex choice preserves it and an unavailable catalog fails with guidance", async ({
    page,
    request,
  }) => {
    const { companyId, issuePrefix } = await seedConfiguredCompany(request, {
      companyName: `E2E-PS-${Date.now()}`,
    });
    const explicitModel = "gpt-fixture-unavailable";
    const agentId = await seedCodexAgent(request, companyId, explicitModel);

    await page.goto(`/${issuePrefix}/agents/${agentId}/configure`);

    // Change an unrelated field to save the existing explicit model as-is.
    await page
      .getByTestId("config-nav")
      .getByRole("button", { name: "Identity" })
      .click();
    const name = page.getByTestId("agent-config-name-input");
    await expect(name).toBeVisible({ timeout: 10_000 });
    await name.fill("Preserved Codex Choice");

    // Save (the floating action bar appears once the config is dirty).
    const saveButton = page.getByRole("button", { name: "Save" });
    await expect(saveButton).toBeVisible({ timeout: 10_000 });
    await saveButton.click();

    const savedRes = await request.get(`/api/agents/${agentId}`);
    expect(savedRes.ok()).toBe(true);
    const saved = await savedRes.json() as { adapterConfig?: { model?: string } };
    expect(saved.adapterConfig?.model).toBe(explicitModel);

    // The fake Codex account advertises only its synthetic account default.
    // The readiness probe must refuse the unlisted explicit choice instead of
    // silently replacing it or switching billing modes.
    await page.getByRole("button", { name: "Adapter & model" }).click();
    const testEnvironmentButton = page.getByRole("button", { name: "Test environment" });
    await expect(testEnvironmentButton).toBeVisible({ timeout: 10_000 });
    await testEnvironmentButton.click();
    const result = page.getByTestId("adapter-env-result");
    await expect(result).toBeVisible({ timeout: 15_000 });
    await expect(result).toContainText(/gpt-fixture-unavailable.*not available.*current CLI catalog/i);
    await expect(result).toContainText(/Select a listed model or clear the model override/i);
    await expect(result).toContainText(/No API-key billing fallback was attempted/i);
  });

  test("cross-family (claude adapter + gpt model) is rejected", async ({
    request,
  }) => {
    const { companyId } = await seedConfiguredCompany(request, {
      companyName: `E2E-PS-${Date.now()}`,
    });
    const agentId = await seedCodexAgent(request, companyId, "gpt-fixture-listed");

    const res = await request.patch(
      `/api/agents/${agentId}?companyId=${companyId}`,
      { data: { adapterType: "claude_local", adapterConfig: { model: "gpt-fixture-listed" } } },
    );
    expect(res.status()).toBe(400);
  });

  test("shell-unsafe model is rejected", async ({ request }) => {
    const { companyId } = await seedConfiguredCompany(request, {
      companyName: `E2E-PS-${Date.now()}`,
    });
    const agentId = await seedCodexAgent(request, companyId);

    // Include adapterType so the shared schema's shell-safety refinement runs
    // (refineAdapterModel early-returns when adapterType is absent). This keeps
    // the rejection on the same 400 schema hard-block path as the cross-family
    // test above; without adapterType the request would instead reach the
    // route's runtime guard and surface as 422.
    const res = await request.patch(
      `/api/agents/${agentId}?companyId=${companyId}`,
      { data: { adapterType: "codex_local", adapterConfig: { model: "gpt-5 && rm" } } },
    );
    expect(res.status()).toBe(400);
  });

  test("test-connection button runs and renders a result", async ({
    page,
    request,
  }) => {
    const { companyId, issuePrefix } = await seedConfiguredCompany(request, {
      companyName: `E2E-PS-${Date.now()}`,
    });
    const agentId = await seedCodexAgent(request, companyId);

    await page.goto(`/${issuePrefix}/agents/${agentId}/configure`);

    // Select the "Adapter & model" rail section to reveal the Test environment
    // button. The rail click can be dropped by a mount-time re-render burst
    // (company-context + adapterModels query + draft-adapter effect settling),
    // stranding the form on the default Identity section — the button then never
    // renders and a plain toBeVisible wait cannot recover a lost click. Retry the
    // rail click until the adapter section actually renders (re-clicking while
    // already on the adapter section is a no-op, so this is idempotent).
    const testEnvironmentButton = page.getByRole("button", { name: "Test environment" });
    await expect(async () => {
      await page.getByRole("button", { name: "Adapter & model" }).click();
      await expect(testEnvironmentButton).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    // Explicit timeout: the button is disabled until company context resolves
    // (`!selectedCompanyId`), which can lag the section switch on a fresh deep-link.
    await expect(testEnvironmentButton).toBeEnabled({ timeout: 10_000 });
    await testEnvironmentButton.dispatchEvent("click");

    // Pass OR fail status both render the result div (codex may be absent on CI).
    // Generous timeout: the probe spawns a real adapter CLI, which can be slow
    // to cold-start on a CI runner.
    await expect(page.getByTestId("adapter-env-result")).toBeVisible({
      timeout: 60_000,
    });
  });

  // ── Provider switch reaches the crew (initial config + Settings) ──

  test("configured OpenAI crew → crew agents are codex_local", async ({
    request,
  }) => {
    // Crew = openai in config → ensureAllCrewAgents seeds the AoA crew on
    // the codex_local adapter (resolveCrewAdapterFor("openai")).
    const { companyId } = await seedConfiguredCompany(request, {
      companyName: `E2E-PS-${Date.now()}`,
      commanderProvider: "anthropic",
      crewProvider: "openai",
    });

    const crew = await getAoaCrew(request, companyId);
    expect(crew.length).toBeGreaterThan(0);
    expect(crew.every((a) => a.adapterType === "codex_local")).toBe(true);
  });

  test("Settings crew provider change re-ensures the crew", async ({
    page,
    request,
  }) => {
    // Seed an anthropic crew (claude_local), then flip the crew provider
    // to OpenCode in Settings → the config PATCH re-runs ensureAllCrewAgents and
    // migrates the existing crew rows to opencode_local.
    const { companyId, issuePrefix } = await seedConfiguredCompany(
      request,
      {
        companyName: `E2E-PS-${Date.now()}`,
        commanderProvider: "anthropic",
        crewProvider: "anthropic",
      },
    );

    // Sanity: the crew starts on claude_local.
    const before = await getAoaCrew(request, companyId);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((a) => a.adapterType === "claude_local")).toBe(true);

    await openCommanderExecutionTab(page, issuePrefix);

    // The crew-provider control is a Radix Select (not a native <select>): open
    // the labelled combobox, then pick the OpenCode option.
    await page.getByRole("combobox", { name: /crew provider/i }).click();
    await page.getByRole("option", { name: "OpenCode" }).click();

    // Save the Execution & Model tab (first Save button on the page).
    await page.getByRole("button", { name: /^save$/i }).first().click();

    await expect
      .poll(
        async () => {
          const crew = await getAoaCrew(request, companyId);
          return (
            crew.length > 0 &&
            crew.every((a) => a.adapterType === "opencode_local")
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test("Settings crew MODEL-only change (same provider) rewrites the crew row's model", async ({ page, request }) => {
    // Seed an anthropic crew pinned to a specific model. crewProvider stays anthropic
    // throughout, so the adapter TYPE never changes — only the model does. This is the
    // path the provider-change tests don't cover (the Task 4b model-drift branch).
    const { companyId, issuePrefix } = await seedConfiguredCompany(request, {
      commanderProvider: "anthropic",
      crewProvider: "anthropic",
      crewModel: "claude-haiku-4-5",
    });

    // After seeding: crew is claude_local pinned to the seeded model.
    await expect.poll(async () => {
      const crew = await getAoaCrew(request, companyId);
      return crew.length > 0
        && crew.every((a) => a.adapterType === "claude_local")
        && crew.every((a) => (a.adapterConfig as { model?: string } | undefined)?.model === "claude-haiku-4-5");
    }, { timeout: 15_000 }).toBe(true);

    // Change ONLY the crew model in Settings (leave the crew provider on anthropic).
    await openCommanderExecutionTab(page, issuePrefix);
    const crewModelInput = page.getByLabel(/crew model/i);
    await crewModelInput.fill("claude-opus-4-1");
    await page.getByRole("button", { name: /^save$/i }).first().click();

    // The crew rows must migrate to the new model — same adapter type, model-only change.
    await expect.poll(async () => {
      const crew = await getAoaCrew(request, companyId);
      return crew.length > 0
        && crew.every((a) => a.adapterType === "claude_local")
        && crew.every((a) => (a.adapterConfig as { model?: string } | undefined)?.model === "claude-opus-4-1");
    }, { timeout: 15_000 }).toBe(true);
  });
});
