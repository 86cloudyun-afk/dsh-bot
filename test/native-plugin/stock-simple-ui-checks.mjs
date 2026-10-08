import assert from 'node:assert/strict';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
import {controlledProvider} from './stock-gui-runtime.mjs';

async function runModelSaveChecks(gui, existing) {
  const provider = 'controlled-reasoning-gui';
  class ReasoningProvider extends LlmAdapter {
    providerInfo(id) {return {id, name:'Controlled reasoning verification'};}
    async listModels(id) {return [{provider:id, id:'reasoner', name:'reasoner'}];}
    async resolveModel(id, model) {return {provider:id, id:model, name:model, reasoning:{efforts:[{id:'low',name:'low'},{id:'high',name:'high'}],defaultEffort:'low'}};}
    async *stream() {throw Error('This editor verification must not submit model requests');}
  }
  gui.app.ctx.llm.registerAdapter([provider], new ReasoningProvider());
  const previous = gui.app.ctx.agentDefaultModel.currentSelection();
  try {
    await gui.app.ctx.agentDefaultModel.saveSelection({provider,model:'reasoner',reasoningEffort:'high'});
    await gui.page.reload({waitUntil:'networkidle'});
    await gui.workbench('Bots');
    await gui.card(existing.name).getByRole('button',{name:'编辑',exact:true}).click();
    const edit = gui.card('编辑 Bot');
    await edit.getByLabel('身份与职责').fill('编辑不串用全局思考参数');
    await edit.getByRole('button',{name:'保存配置',exact:true}).click();
    const state = await gui.until(s => s.bots.find(b => b.botId === existing.botId)?.role === '编辑不串用全局思考参数', 'rename under another global model');
    assert.deepEqual(state.bots.find(b => b.botId === existing.botId).contact, existing.contact);
    gui.check('renamingDoesNotImportGlobalReasoningEffort', true);

    await gui.page.getByRole('button',{name:'创建另一个 Bot',exact:true}).click();
    let create = gui.card('创建具名 Bot');
    await create.getByLabel('名称',{exact:true}).fill('沿用当前思考参数');
    await create.getByRole('button',{name:'创建 Bot',exact:true}).click();
    const defaults = (await gui.until(s => s.bots.some(b => b.name === '沿用当前思考参数'), 'reasoning default creation')).bots.find(b => b.name === '沿用当前思考参数');
    assert.equal(defaults.contact.reasoningEffort, 'high');
    assert.deepEqual(defaults.execution, defaults.contact);
    assert.equal(defaults.executionMode, 'inherit');
    gui.check('executionInheritancePreservesCurrentReasoningDefaults', true);

    create = gui.card('创建具名 Bot');
    await create.getByLabel('名称',{exact:true}).fill('明确指定任务模型');
    await create.getByLabel('模型',{exact:true}).selectOption(JSON.stringify({provider:controlledProvider,model:'model-a'}));
    await gui.expand(create, '更多设置');
    assert.equal(await create.getByLabel('联络思考程度（留空使用当前模型默认）').inputValue(), '');
    await create.getByLabel('执行模型',{exact:true}).selectOption(JSON.stringify({provider:controlledProvider,model:'model-a'}));
    await create.getByRole('button',{name:'创建 Bot',exact:true}).click();
    const explicit = (await gui.until(s => s.bots.some(b => b.name === '明确指定任务模型'), 'different model creation')).bots.find(b => b.name === '明确指定任务模型');
    assert.equal(explicit.contact.reasoningEffort, undefined);
    gui.check('newModelSelectionClearsIncompatibleReasoning', true);
    await gui.card(explicit.name).getByRole('button',{name:'编辑',exact:true}).click();
    const explicitEdit = gui.card('编辑 Bot');
    await gui.expand(explicitEdit, '更多设置');
    assert.equal(await explicitEdit.getByLabel('执行模型',{exact:true}).inputValue(), JSON.stringify({provider:controlledProvider,model:'model-a'}));
    await explicitEdit.getByLabel('模型',{exact:true}).selectOption(JSON.stringify({provider:controlledProvider,model:'model-b'}));
    await explicitEdit.getByRole('button',{name:'保存配置',exact:true}).click();
    const changed = (await gui.until(s => s.bots.find(b => b.botId === explicit.botId)?.contact.model === 'model-b', 'fixed explicit execution route')).bots.find(b => b.botId === explicit.botId);
    assert.equal(changed.execution.model, 'model-a');
    assert.equal(changed.executionMode, 'explicit');
    gui.check('explicitSameRouteExecutionRemainsFixedAfterReopening', true);
  } finally {
    await gui.app.ctx.agentDefaultModel.saveSelection(previous);
  }
}

export async function runSimpleUiChecks(gui) {
  await gui.workbench('Bots');
  const editor = gui.card('创建具名 Bot');
  assert.equal(await editor.locator('input:visible,select:visible,textarea:visible').count(), 3);
  gui.check('botCreationHasOnlyThreeVisibleFields', true);
  assert.equal(await gui.page.locator('[name="capabilities"]').count(), 0);
  gui.check('noManualNativeToolConfiguration', true);
  const nav = gui.page.getByRole('navigation', {name: 'Bot 工作台功能'});
  assert.equal(await nav.getByRole('button').count(), 5);
  gui.check('fivePrimaryWorkbenchSections', true);
  await editor.getByLabel('名称', {exact: true}).fill('简洁创建 Bot');
  await editor.getByRole('button', {name: '创建 Bot', exact: true}).click();
  const state = await gui.until(s => s.bots.some(b => b.name === '简洁创建 Bot'), 'minimal Bot creation');
  const created = state.bots.find(b => b.name === '简洁创建 Bot');
  assert.ok(created.cwd);
  assert.equal(created.contact.provider, gui.app.ctx.agentDefaultModel.currentSelection().provider);
  assert.equal(created.contact.model, gui.app.ctx.agentDefaultModel.currentSelection().model);
  assert.equal(created.contact.model, created.execution.model);
  gui.check('nameOnlyCreationUsesConfiguredDefaults', true);
  await gui.card(created.name).getByRole('button', {name: '开始聊天', exact: true}).click();
  const withContact = await gui.until(s => s.sessions.some(row => row.botId === created.botId && row.purpose === 'contact'), 'selected Bot conversation');
  assert.equal(withContact.sessions.filter(row => row.botId === created.botId && row.purpose === 'contact').length, 1);
  await gui.page.locator('[data-composer-input="true"][contenteditable="true"]').waitFor();
  gui.check('botCardStartsItsOwnConversationDirectly', true);
  await gui.workbench('Bots');
  await gui.card(created.name).getByRole('button', {name: '编辑', exact: true}).click();
  const editing = gui.card('编辑 Bot');
  assert.equal(await editing.locator('input:visible,select:visible,textarea:visible').count(), 3);
  await editing.getByLabel('身份与职责').fill('保存简洁编辑');
  await editing.getByRole('button', {name: '保存配置', exact: true}).click();
  const edited = (await gui.until(s => s.bots.find(b => b.botId === created.botId)?.role === '保存简洁编辑', 'simple edit')).bots.find(b => b.botId === created.botId);
  assert.deepEqual(edited.contact, created.contact);
  assert.deepEqual(edited.execution, created.execution);
  assert.equal(edited.cwd, created.cwd);
  gui.check('collapsedSettingsRetainExistingConfiguration', true);
  await runModelSaveChecks(gui, edited);
  for (const tab of ['共享与授权', '会话管理', '结果与投递', '内部群', '会议', '记忆', '任务']) await gui.workbench(tab);
  gui.check('allOriginalManagementAndCollaborationSectionsAccessible', true);
  const taskForm = gui.card('新任务');
  assert.equal(await taskForm.locator('input:visible,select:visible,textarea:visible').count(), 3);
  await taskForm.getByLabel('标题', {exact: true}).fill('简洁登记任务');
  await taskForm.getByLabel('目标', {exact: true}).fill('只回复任务结果');
  await taskForm.getByRole('button', {name: '登记任务', exact: true}).click();
  await gui.until(s => s.tasks.some(row => row.title === '简洁登记任务'), 'minimal task registration');
  assert.equal(await gui.card('简洁登记任务').getByLabel('新目标').isVisible(), false);
  gui.check('taskRegistrationUsesOnlyThreeVisibleFields', true);
  gui.check('taskAdjustmentIsCollapsedByDefault', true);
  await gui.save('simple-workbench');
  gui.check('noBrowserScriptErrors', gui.errors.length === 0);
}
