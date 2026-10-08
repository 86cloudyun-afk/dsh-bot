import assert from "node:assert/strict";
import { join } from "node:path";
import { waitFor } from "./stock-gui-runtime.mjs";

/** Actual stock browser forms, with concurrent changes from another page. */
export async function runUiRegressions(gui) {
  const other = await gui.context.newPage();
  other.on("pageerror", error => gui.errors.push({ stage: "ui-regressions", message: error.message }));
  await other.goto(gui.url, { waitUntil: "networkidle" });
  const command = (action, input) => other.evaluate(async ({ action, input }) => {
    const response = await fetch("/api/dsh.bot/command", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId: crypto.randomUUID(), method: "dsh.bot/command", payload: { operationId: crypto.randomUUID(), action, input } }),
    });
    const reply = await response.json();
    if (!reply.result?.ok) throw Error(reply.result?.error?.code ?? "Command failed");
    return reply.result.value;
  }, { action, input });
  const template = (await gui.snapshot()).bots[0];
  const create = name => command("bot.create", { name, role: "Original role", cwd: join(gui.root, "work"), contact: template.contact, execution: template.execution });
  try {
    const owner = await create("界面校验所有者"), b = await create("界面校验乙"), c = await create("界面校验丙"),
      selected = [b, c].sort((a, b) => a.botId.localeCompare(b.botId)).at(-1);
    await gui.workbench("共享与授权");
    const sharing = gui.card(`${owner.name} 的共享范围`);
    await sharing.waitFor();
    for (const input of await sharing.locator('input[name="receiver"]').all()) {
      if (await input.getAttribute("value") === selected.botId) await input.check();
      else await input.uncheck();
    }
    const checked = () => sharing.locator('input[name="receiver"]:checked').evaluateAll(rows => rows.map(row => row.value));
    assert.deepEqual(await checked(), [selected.botId]);
    let inserted;
    for (let i = 0; i < 32; i++) {
      inserted = await create(`界面校验新增 ${i}`);
      if (inserted.botId.localeCompare(selected.botId) < 0) break;
    }
    assert.ok(inserted.botId.localeCompare(selected.botId) < 0);
    await sharing.locator(`input[name="receiver"][value="${inserted.botId}"]`).waitFor();
    assert.deepEqual(await checked(), [selected.botId]);
    gui.check("shareDraftRemainsBoundToSelectedBotIds", true);
    await sharing.getByRole("button", { name: "保存共享上限", exact: true }).click();
    await gui.until(snapshot => snapshot.bots.find(bot => bot.botId === owner.botId).share.receivers.length === 1, "shared recipient save");
    assert.deepEqual((await gui.snapshot()).bots.find(bot => bot.botId === owner.botId).share.receivers, [selected.botId]);
    gui.check("savingShareDoesNotAddAnUnselectedBot", true);

    await gui.workbench("Bots");
    await gui.card(owner.name).getByRole("button", { name: "编辑", exact: true }).click();
    await gui.page.getByLabel("身份与职责").fill("UNSAVED_UI_ROLE");
    const fresh = (await gui.snapshot()).bots.find(bot => bot.botId === owner.botId), changedName = `${owner.name}已改名`;
    await command("bot.update", { botId: owner.botId, expectedVersion: fresh.revision, name: changedName });
    await gui.page.getByRole("heading", { name: changedName, exact: true }).waitFor();
    assert.equal(await gui.page.getByLabel("身份与职责").inputValue(), "UNSAVED_UI_ROLE");
    await gui.page.getByRole("button", { name: "保存配置", exact: true }).click();
    await gui.page.getByRole("alert").filter({ hasText: "revision_conflict" }).waitFor();
    assert.equal((await gui.snapshot()).bots.find(bot => bot.botId === owner.botId).role, "Original role");
    assert.equal(await gui.page.getByLabel("身份与职责").inputValue(), "UNSAVED_UI_ROLE");
    gui.check("externalBotUpdatePreservesDraftAndChecksItsOriginalVersion", true);
    await gui.page.getByRole("button", { name: "重新载入最新配置", exact: true }).click();
    assert.equal(await gui.page.getByLabel("名称", { exact: true }).inputValue(), changedName);
    assert.equal(await gui.page.getByLabel("身份与职责").inputValue(), "Original role");
    await gui.page.getByLabel("身份与职责").fill("Saved after explicit reload");
    await gui.page.getByRole("button", { name: "保存配置", exact: true }).click();
    await gui.until(snapshot => snapshot.bots.find(bot => bot.botId === owner.botId).role === "Saved after explicit reload", "save rebased Bot draft");
    gui.check("explicitBotDraftReloadAllowsSavingTheLatestVersion", true);

    const duplicateA = await create("同名校验 Bot"), duplicateB = await create("同名校验 Bot");
    await waitFor(async () => await gui.page.getByRole("heading", { name: /^同名校验 Bot · bot_/ }).count() === 2, "disambiguated Bot cards");
    await gui.page.getByRole("button", { name: "新建 Bot 会话", exact: true }).last().click();
    const dialog = gui.page.getByRole("dialog", { name: "新建 Bot 会话" }),
      options = await dialog.locator('select[name="botId"] option').evaluateAll(rows => rows.map(row => ({ value: row.value, label: row.label }))),
      labels = [duplicateA, duplicateB].map(bot => options.find(row => row.value === bot.botId)?.label);
    assert.equal(new Set(labels).size, 2);
    for (const bot of [duplicateA, duplicateB]) assert.ok(options.find(row => row.value === bot.botId)?.label.includes(bot.botId));
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    gui.check("duplicateBotNamesAreDisambiguatedByStableIdentity", true);

    await gui.workbench("任务");
    const form = gui.card("新任务");
    await form.getByLabel("标题", { exact: true }).fill("UNSAVED_UI_TASK");
    const workspace = await gui.app.ctx.workspaceRegistry.create(join(gui.root, "work")),
      ordinary = await gui.app.ctx.sessionController.create({ workspaceId: workspace.id }, new AbortController().signal);
    await gui.page.getByRole("button", { name: "刷新", exact: true }).click();
    await form.locator(`select[name="origin"] option[value="${ordinary.sessionId}"]`).waitFor({ state: "attached" });
    assert.equal(await form.getByLabel("标题", { exact: true }).inputValue(), "UNSAVED_UI_TASK");
    gui.check("refreshAddsOrdinaryResultRecipientsWithoutClearingTaskDraft", true);
  } finally { await other.close(); }
}
