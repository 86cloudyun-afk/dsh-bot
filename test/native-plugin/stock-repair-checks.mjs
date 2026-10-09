import assert from 'node:assert/strict';
import {controlledProvider} from './stock-gui-runtime.mjs';

export async function runRepairChecks(gui) {
  const service=gui.app.ctx.dshBot, actor=service.policy.fromPeer(gui.app.ctx.connection.operator);
  const dispatch=(action,input)=>service.dispatch(actor,{operationId:crypto.randomUUID(),action,input});
  const refresh=()=>gui.page.getByRole('button',{name:'刷新',exact:true}).click();
  const beforeRequests=gui.report.requests.length;
  await gui.workbench('Bots');
  let editor=gui.card('创建具名 Bot');
  const before=(await gui.snapshot()).bots.length;
  const mismatch=async route=>{
    const response=await route.fetch(),body=await response.json();
    delete body.result.value.pluginVersion;
    delete body.result.value.clientProtocol;
    await route.fulfill({response,json:body});
  };
  await gui.page.route('**/api/dsh.bot/snapshot',mismatch);
  await editor.getByLabel('名称',{exact:true}).fill('受版本检查保护');
  await editor.getByRole('button',{name:'创建 Bot',exact:true}).click();
  await gui.page.getByRole('alert').filter({hasText:'plugin_version_mismatch'}).waitFor();
  assert.equal(service.snapshot(actor).bots.length,before);
  gui.check('mixedReleaseRefusesFirstBotWrite',true);
  await gui.page.unroute('**/api/dsh.bot/snapshot',mismatch);
  await refresh();

  let original;
  const lostReply=async route=>{
    const envelope=route.request().postDataJSON();
    if(envelope.payload.action==='bot.create' && !original) {
      original=envelope.payload;
      const response=await route.fetch();
      assert.equal((await response.json()).result.ok,true);
      await route.abort('failed');
    } else await route.continue();
  };
  await gui.page.route('**/api/dsh.bot/command',lostReply);
  await editor.getByLabel('名称',{exact:true}).fill('丢失回执仅创建一次');
  await editor.getByRole('button',{name:'创建 Bot',exact:true}).click();
  await gui.page.getByRole('alert').filter({hasText:'结果未确认'}).waitFor();
  await gui.page.unroute('**/api/dsh.bot/command',lostReply);
  assert.ok(original?.operationId);
  const pending=gui.card('待查回的原始操作').locator('div.actions').filter({hasText:original.operationId});
  await pending.getByRole('button',{name:'查回原始操作',exact:true}).click();
  await pending.waitFor({state:'hidden'});
  assert.equal(service.snapshot(actor).bots.filter(bot=>bot.name==='丢失回执仅创建一次').length,1);
  gui.check('lostFirstBotReceiptReadWithoutReplay',true);

  editor=gui.card('创建具名 Bot');
  await editor.getByLabel('名称',{exact:true}).fill('明确拒绝的配置');
  await gui.expand(editor,'更多设置');
  await editor.getByLabel('联络思考程度（留空使用当前模型默认）').fill('unsupported');
  await editor.getByRole('button',{name:'创建 Bot',exact:true}).click();
  await gui.page.getByRole('alert').filter({hasText:'提交被拒，未写入 Bot 配置'}).waitFor();
  const missing=gui.card('待查回的原始操作').locator('div.actions').last();
  await missing.getByRole('button',{name:'查回原始操作',exact:true}).click();
  await gui.page.getByRole('alert').filter({hasText:'暂无已提交回执'}).waitFor();
  assert.equal(service.snapshot(actor).bots.some(bot=>bot.name==='明确拒绝的配置'),false);
  gui.check('rejectedFirstBotRetainsOriginalWithoutAutomaticRetry',true);
  const retainedId=await missing.locator('small').innerText();
  await missing.getByRole('button',{name:'保留并收起',exact:true}).click();
  await missing.waitFor({state:'hidden'});
  await gui.page.reload({waitUntil:'networkidle'});await gui.workbench('Bots');
  await gui.page.locator('details').filter({has:gui.page.locator('summary').filter({hasText:'保留的原始操作'})}).locator('small').filter({hasText:retainedId}).waitFor({state:'attached'});
  gui.check('foldedOriginalRequestSurvivesBrowserReload',true);

  const bot=service.snapshot(actor).bots.find(bot=>bot.name==='丢失回执仅创建一次');
  await gui.card(bot.name).getByRole('button',{name:'编辑',exact:true}).click();
  let editing=gui.card('编辑 Bot');
  await gui.expand(editing,'更多设置');
  const contactChoice=JSON.stringify({provider:controlledProvider,model:'model-b'}),executionChoice=JSON.stringify({provider:controlledProvider,model:'model-a'});
  await editing.getByLabel('模型',{exact:true}).selectOption(contactChoice);
  await editing.getByLabel('执行模型',{exact:true}).selectOption(executionChoice);
  const removeModels=async route=>{
    const response=await route.fetch(),body=await response.json();
    const provider=body.result.value.providers.find(row=>row.id===controlledProvider);
    provider.models=provider.models.filter(row=>!['model-a','model-b'].includes(row.id));
    await route.fulfill({response,json:body});
  };
  await gui.page.route('**/api/dsh.bot/catalog',removeModels);await refresh();
  assert.equal(await editing.getByLabel('模型',{exact:true}).inputValue(),contactChoice);
  assert.equal(await editing.getByLabel('执行模型',{exact:true}).inputValue(),executionChoice);
  await editing.getByRole('button',{name:'保存配置',exact:true}).click();
  await gui.until(snapshot=>snapshot.bots.find(row=>row.botId===bot.botId)?.contact.model==='model-b','unsaved model choices after catalog refresh');
  assert.equal(service.store.read().bots[bot.botId].execution.model,'model-a');
  await gui.page.unroute('**/api/dsh.bot/catalog',removeModels);
  gui.check('unsavedContactAndExecutionChoicesSurviveCatalogRemoval',true);
  const task=await dispatch('task.create',{botId:bot.botId,title:'并发目标草稿',goal:'Initial goal',criteria:[]});
  await gui.workbench('任务');await refresh();
  const taskCard=gui.card(task.title);
  await gui.expand(taskCard,'调整与接续');
  await taskCard.getByLabel('新目标').fill('Local draft');
  await dispatch('task.adjust',{taskId:task.taskId,expectedVersion:task.version,goal:'Other page goal'});
  await refresh();
  await taskCard.getByText('Other page goal',{exact:true}).first().waitFor();
  await taskCard.getByRole('button',{name:'调整目标',exact:true}).click();
  await gui.page.getByRole('alert').filter({hasText:'revision_conflict'}).waitFor();
  assert.equal(service.store.read().tasks[task.taskId].goal,'Other page goal');
  assert.equal(await taskCard.getByLabel('新目标').inputValue(),'Local draft');
  await taskCard.getByRole('button',{name:'重新载入最新任务',exact:true}).click();
  await taskCard.getByLabel('新目标').fill('Reviewed goal');
  await taskCard.getByRole('button',{name:'调整目标',exact:true}).click();
  await gui.until(snapshot=>snapshot.tasks.find(row=>row.taskId===task.taskId)?.goal==='Reviewed goal','reviewed task draft');
  gui.check('taskDraftConflictPreservesBothDraftAndNewGoal',true);

  await gui.workbench('共享与授权');await refresh();
  const share=gui.card(`${bot.name} 的共享范围`),base=service.store.read().bots[bot.botId];
  const revoked={enabled:false,receivers:[],scope:{sessions:[],tasks:[],memories:[]}};
  await dispatch('share.set',{botId:bot.botId,expectedVersion:base.revision,share:revoked});
  await refresh();
  await share.getByRole('button',{name:'重新载入最新共享范围',exact:true}).waitFor();
  await share.getByRole('button',{name:'保存共享上限',exact:true}).click();
  await gui.page.getByRole('alert').filter({hasText:'revision_conflict'}).waitFor();
  assert.deepEqual(service.store.read().bots[bot.botId].share,revoked);
  await share.getByRole('button',{name:'重新载入最新共享范围',exact:true}).click();
  assert.equal(await share.getByLabel('允许其他 Bot 只读了解').isChecked(),false);
  gui.check('staleSharingDraftCannotRestoreRevokedAccess',true);

  const presets=gui.app.ctx.get('agentPresets');
  assert.ok(presets,'Stock profile must supply native presets');
  let removePreset=await presets.register({id:'repair-custom',plugins:[]});
  try {
    const presetBot=await dispatch('bot.create',{name:'原生默认配置恢复',presetId:'repair-custom',contact:{provider:controlledProvider,model:'model-a'}});
    await gui.workbench('Bots');await refresh();
    await gui.card(presetBot.name).getByRole('button',{name:'编辑',exact:true}).click();
    editing=gui.card('编辑 Bot');
    await gui.expand(editing,'更多设置');
    await removePreset();await refresh();
    assert.equal(await editing.getByLabel('原生 Agent preset').inputValue(),'repair-custom');
    await editing.getByLabel('名称',{exact:true}).fill('目录刷新不能暗改配置');
    await editing.getByRole('button',{name:'保存配置',exact:true}).click();
    await gui.page.getByRole('alert').filter({hasText:'agent-preset/not-found'}).waitFor();
    assert.equal(service.store.read().bots[presetBot.botId].presetId,'repair-custom');
    gui.check('missingNativePresetNeverImplicitlyResetsOnRename',true);
    removePreset=await presets.register({id:'repair-custom',plugins:[]});await refresh();
    await editing.getByLabel('原生 Agent preset').selectOption('');
    await editing.getByRole('button',{name:'保存配置',exact:true}).click();
    await gui.until(snapshot=>snapshot.bots.find(row=>row.botId===presetBot.botId)?.presetId===presets.defaultId,'native preset reset');
    gui.check('nativePresetDefaultSelectionActuallyResets',true);
  } finally {await removePreset();}
  gui.check('repairRecoveryChecksIssueNoModelRequests',gui.report.requests.length===beforeRequests);
  await gui.save('release-repair');
}
