import {randomUUID} from "node:crypto";
import {expect, test} from "@playwright/test";
import {createDb, instanceUserRoles, issues} from "../../packages/db/src/index";

test("authenticated route persists real task panel lifecycle through HTTP and reload", async ({browser}) => {
  test.setTimeout(120_000);
  const baseURL = process.env.AOA_AUTH_E2E_BASE_URL!;
  const context = await browser.newContext({baseURL, extraHTTPHeaders: {Origin: baseURL}});
  const db = createDb(process.env.AOA_AUTH_E2E_DATABASE_URL!);
  try {
    // Canonical loopback-only test seam mints a real Better Auth session; all
    // workspace calls below use normal session middleware and the real database.
    const signup = await context.request.post("/api/test-support/session", {
      headers: {Authorization: `Bearer ${process.env.AOA_E2E_TEST_SUPPORT_TOKEN}`}, data: {
      name: "Universe acceptance", email: `universe-${randomUUID()}@example.test`,
    }});
    expect(signup.ok(), await signup.text()).toBe(true);
    const minted = await signup.json();
    await context.addCookies([{name: minted.cookie.name, value: minted.cookie.value,
      url: baseURL, httpOnly: true, sameSite: "Lax"}]);
    const session = await (await context.request.get("/api/auth/get-session")).json();
    await db.insert(instanceUserRoles).values({userId: session.user.id, role: "instance_admin"}).onConflictDoNothing();
    const created = await context.request.post("/api/companies", {data: {name: `Universe ${randomUUID().slice(0,8)}`, budgetMonthlyCents: 0}});
    expect(created.ok(), await created.text()).toBe(true);
    const company = await created.json();
    const [task, otherTask] = await db.insert(issues).values([
      {companyId: company.id, title: "Persistence acceptance task", identifier: `${company.issuePrefix}-901`, status: "todo"},
      {companyId: company.id, title: "Independent panel task", identifier: `${company.issuePrefix}-902`, status: "todo"},
    ]).returning();
    const conversationResponse = await context.request.post(`/api/companies/${company.id}/internal-agent/conversations`, {data: {title: "Acceptance workspace"}});
    expect(conversationResponse.ok(), await conversationResponse.text()).toBe(true);
    const conversation = await conversationResponse.json();
    const layoutURL = `/api/companies/${company.id}/universe/conversations/${conversation.id}/layout`;
    const readLayout = async () => {
      const result = await context.request.get(layoutURL);
      expect(result.ok(), await result.text()).toBe(true);
      return result.json();
    };
    const page = await context.newPage();
    await page.goto(`/${company.issuePrefix}/universe`);
    await page.getByLabel("Conversation", {exact: true}).selectOption(conversation.id);
    await expect(page.getByLabel("Open task", {exact: true})).toBeEnabled();
    await page.getByLabel("Open task", {exact: true}).selectOption(task.id);
    const panel = page.locator(".universe-panel").filter({has: page.getByText(task.title, {exact: true})});
    await expect(panel).toBeVisible();
    await expect.poll(async () => (await readLayout()).document.panels.length).toBe(1);
    const second = await context.newPage();
    await second.goto(`/${company.issuePrefix}/universe`);
    await second.getByLabel("Conversation", {exact: true}).selectOption(conversation.id);
    await expect(second.getByRole("button", {name: "Pin panel", exact: true})).toBeVisible();
    await panel.getByRole("button", {name: "Pin panel", exact: true}).click();
    await expect.poll(async () => (await readLayout()).document.panels[0].pinned).toBe(true);
    const pinRevision = (await readLayout()).revision;
    await second.getByRole("button", {name: "Pin panel", exact: true}).click();
    await expect(second.getByText("Compare layout changes")).toBeVisible();
    expect((await readLayout()).revision).toBe(pinRevision);
    await second.getByRole("button", {name: "Use saved layout"}).click();
    await expect(second.getByText("Compare layout changes")).toHaveCount(0);
    await second.close();
    const saved = await readLayout();
    await page.reload();
    await page.getByLabel("Conversation", {exact: true}).selectOption(conversation.id);
    await expect(panel.getByRole("button", {name: "Unpin panel", exact: true})).toBeVisible();
    expect((await readLayout()).document.panels[0].rect).toEqual(saved.document.panels[0].rect);
    await panel.getByPlaceholder("Add a comment...").fill("Unsent task draft");
    await panel.getByRole("button", {name: "Minimize panel", exact: true}).click();
    await expect(panel).toBeHidden();
    await expect.poll(async () => (await readLayout()).document.panels[0].minimized).toBe(true);
    const key = (await readLayout()).document.order[0];
    await page.getByLabel("Open panels", {exact: true}).selectOption(key);
    await expect(panel).toBeVisible();
    await expect(panel.getByPlaceholder("Add a comment...")).toHaveValue("Unsent task draft");
    await panel.getByRole("button", {name: "Send", exact: true}).click();
    await expect.poll(async () => {
      const response = await context.request.get(`/api/issues/${task.id}/comments`);
      expect(response.ok(), await response.text()).toBe(true);
      const rows = await response.json() as Array<{body: string}>;
      return rows.filter(row => row.body === "Unsent task draft").length;
    }).toBe(1);
    await panel.getByRole("button", {name: "Maximize panel", exact: true}).click();
    await expect.poll(async () => (await readLayout()).document.maximized).toBe(key);
    await panel.getByRole("button", {name: "Restore panel", exact: true}).click();
    await expect.poll(async () => (await readLayout()).document.maximized).toBeNull();
    // Commit the real HTTP request, then drop only its response. This fault
    // injection does not replace server behavior with a simulated transport.
    const beforeLostReply = (await readLayout()).revision;
    let replyDropped = false;
    await page.route(`**${layoutURL}`, async route => {
      if (route.request().method() !== "PATCH" || replyDropped) return route.continue();
      replyDropped = true;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort("failed");
    });
    await panel.getByRole("button", {name: "Unpin panel", exact: true}).click();
    await expect.poll(async () => (await readLayout()).revision).toBe(beforeLostReply + 1);
    await page.reload();
    await page.getByLabel("Conversation", {exact: true}).selectOption(conversation.id);
    await expect(panel.getByRole("button", {name: "Pin panel", exact: true})).toBeVisible();
    await expect(page.getByRole("status", {name: "Layout save status"})).toHaveText("Saved");
    expect((await readLayout()).revision).toBe(beforeLostReply + 1);
    await page.screenshot({path: "test-results/universe-production/task-panel.png"});
    await panel.getByRole("button", {name: "Close panel", exact: true}).click();
    await expect.poll(async () => (await readLayout()).document.panels.length).toBe(0);
    await page.reload();
    await page.getByLabel("Conversation", {exact: true}).selectOption(conversation.id);
    await expect(page.locator(".universe-panel")).toHaveCount(0);
    await page.getByLabel("Open task", {exact: true}).selectOption(task.id);
    await expect.poll(async () => (await readLayout()).document.panels.length).toBe(1);
    await page.getByLabel("Open task", {exact: true}).selectOption(otherTask.id);
    await expect.poll(async () => (await readLayout()).document.panels.length).toBe(2);
    const independent = await context.newPage();
    await independent.goto(`/${company.issuePrefix}/universe`);
    await independent.getByLabel("Conversation", {exact: true}).selectOption(conversation.id);
    const otherPanel = independent.locator(".universe-panel").filter({has: independent.getByText(otherTask.title, {exact: true})});
    await expect(otherPanel).toBeVisible();
    const firstKey = (await readLayout()).document.panels.find((p: {ref: {id: string}}) => p.ref.id === task.id).key;
    await page.getByLabel("Open panels", {exact: true}).selectOption(firstKey);
    await panel.getByRole("button", {name: "Pin panel", exact: true}).click();
    await expect.poll(async () => (await readLayout()).document.panels.find((p: {ref: {id: string}}) => p.ref.id === task.id)?.pinned).toBe(true);
    await otherPanel.getByRole("button", {name: "Pin panel", exact: true}).click();
    await expect.poll(async () => (await readLayout()).document.panels.every((p: {pinned: boolean}) => p.pinned)).toBe(true);
    await expect(independent.getByText("Compare layout changes")).toHaveCount(0);
    await independent.close();
    const logout = await context.request.post("/api/auth/sign-out", {data: {}});
    expect(logout.ok(), await logout.text()).toBe(true);
    expect([401, 403]).toContain((await context.request.get(layoutURL)).status());
    await page.reload();
    await expect(page.getByLabel("Universe workspace", {exact: true})).toHaveCount(0);
  } finally {
    await context.close();
    await (db as typeof db & {$client: {end: () => Promise<void>}}).$client.end();
  }
});
