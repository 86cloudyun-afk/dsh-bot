import assert from 'node:assert/strict';
import {waitFor} from './stock-gui-runtime.mjs';

const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
const details=(scope,title)=>{
  const page=typeof scope.page==='function'?scope.page():scope;
  return scope.locator('details').filter({has:page.locator('summary').filter({hasText:new RegExp(`^${title}$`)})});
};
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const paint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const observe=promise=>Promise.resolve(promise).then(value=>({value}),error=>({error}));
async function observed(promise) {const outcome=await promise;if(Object.hasOwn(outcome,'error'))throw outcome.error;return outcome.value;}
const payloadFor=request=>{try{return request.postDataJSON()?.payload;}catch{return undefined;}};
const requestFor=(response,action)=>payloadFor(response.request())?.action===action;
async function cleanup(primary,steps) {
  const failures=[];
  const retain=error=>{if(!failures.includes(error))failures.push(error);};
  if(primary!==undefined)retain(primary);
  for(const step of steps)try {await step();} catch(error) {retain(error);}
  if(failures.length===1)throw failures[0];
  if(failures.length>1)throw new AggregateError(failures,'Actual UI and route cleanup failed',{cause:primary??failures[0]});
}

async function uiRpc(gui,action,interact,accept=()=>true,errorCode) {
  gui.report.v113Quality.uiCommands++;
  const responsePromise=gui.page.waitForResponse(response=>requestFor(response,action)&&accept(payloadFor(response.request())));
  const [,response]=await Promise.all([Promise.resolve().then(interact),responsePromise]);
  const request=payloadFor(response.request()),reply=(await response.json()).result;
  assert.equal(reply?.ok,errorCode===undefined,`${action}: ${reply?.error?.code}`);
  if(errorCode!==undefined)assert.equal(reply.error.code,errorCode);
  else if(request.operationId)assert.ok(gui.app.ctx.dshBot.store.read().operations[request.operationId]);
  if(request.operationId)await waitFor(()=>button(gui.page,'刷新').isEnabled(),`${action} original UI command finished refreshing`);
  await paint(gui.page);
  return {request,value:reply.value,error:reply.error};
}
async function command(gui,action,input) {
  gui.report.v113Quality.apiCommands++;
  const request={operationId:crypto.randomUUID(),action,input};
  const reply=await gui.page.evaluate(async payload=>{
    const response=await fetch('/api/dsh.bot/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'dsh.bot/command',payload})});
    return (await response.json()).result;
  },request);
  assert.equal(reply?.ok,true,`${action}: ${reply?.error?.code}`);
  assert.ok(gui.app.ctx.dshBot.store.read().operations[request.operationId]?.result);
  return {request,value:reply.value};
}

async function trackedRoute(gui,path,handle) {
  const active=new Set(),failures=[];
  const throwFailure=()=>{if(failures.length===1)throw failures[0];if(failures.length>1)throw new AggregateError(failures,'Actual route lifecycle failed');};
  const drain=async()=>{while(active.size)await Promise.allSettled([...active]);};
  const handler=async route=>{
    const work=Promise.resolve().then(()=>handle(route));active.add(work);
    // Playwright dispatches route callbacks without an awaitable public promise.
    // Awaited lifecycle methods surface failures while preserving the first error.
    try {await work;} catch(error) {failures.push(error);} finally {active.delete(work);}
  };
  await gui.page.route(path,handler);
  return {failures,throwFailure,drain,close:()=>cleanup(undefined,[()=>gui.page.unroute(path,handler),drain,throwFailure])};
}

// Hold delivery of one genuine installed reply; never replace its body.
async function holdReply(gui,path,accept=()=>true) {
  const release=deferred(),completed=deferred();let actual,request,claimed=false;
  const scope=await trackedRoute(gui,path,async route=>{
    const envelope=route.request().postDataJSON();
    if(claimed||!accept(envelope))return route.continue();
    claimed=true;request=envelope;
    try {
      const response=await route.fetch();actual=(await response.json()).result;
      assert.ok(actual&&typeof actual==='object','Actual held RPC response must include its result');
      await release.promise;await route.fulfill({response});
    } finally {completed.resolve();}
  });
  return {get actual(){return actual;},get request(){return request;},
    async ready(){await waitFor(()=>actual!==undefined||scope.failures.length,'held actual installed reply');scope.throwFailure();assert.equal(actual.ok,true);},
    async finish(){assert.ok(claimed,'A genuine reply must be selected before finishing');release.resolve();await completed.promise;await scope.drain();scope.throwFailure();await paint(gui.page);},
    async close(){release.resolve();await scope.close();}};
}

async function forcedCatalogRefresh(gui) {
  await gui.workbench('Bots');
  const baseline=gui.page.waitForResponse(response=>response.url().endsWith('/api/dsh.bot/catalog'));
  await Promise.all([button(gui.page,'刷新').click(),baseline]);await paint(gui.page);
  const presets=gui.app.ctx.get('agentPresets'),presetId='v113-catalog-during-poll';
  assert.ok(presets,'Stock profile must supply the native preset registry');
  const option=gui.card('创建具名 Bot').getByLabel('原生 Agent preset').locator(`option[value="${presetId}"]`);
  assert.equal(await option.count(),0);
  const held=await holdReply(gui,'**/api/dsh.bot/snapshot');let removePreset,reloaded,primary;
  try {
    // No UI command starts this read: select the workbench's actual periodic poll.
    await held.ready();
    removePreset=await presets.register({id:presetId,plugins:[]});
    reloaded=observe(gui.page.waitForResponse(response=>response.url().endsWith('/api/dsh.bot/catalog')));
    await button(gui.page,'刷新').click();await paint(gui.page);
    assert.equal(await option.count(),0,'The held catalogless poll cannot supply the newly registered native preset');
    await held.finish();
    const response=await observed(reloaded),reply=(await response.json()).result;
    assert.equal(reply?.ok,true);assert.ok(reply.value.presets.some(row=>row.id===presetId));
    await option.waitFor({state:'attached'});
    gui.check('v113ForcedRefreshDuringActualPollLoadsLatestCatalog',true);
  } catch(error) {primary=error;} finally {await cleanup(primary,[()=>held.close(),()=>reloaded&&observed(reloaded),()=>removePreset?.()]);}
}

async function materialRetry(gui) {
  const service=gui.app.ctx.dshBot,botId=gui.botIds[0],marker='V113ACTUALMATERIALRETRY';
  const material=await command(gui,'material.ingest',{botId,title:marker,text:`# ${marker}\nActual installed material retry evidence.`,mediaType:'text/markdown'});
  await gui.workbench('记忆');await button(gui.page,'刷新').click();
  await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(botId);await button(gui.page,'资料').click();
  const search=gui.card('资料检索');await search.getByRole('heading',{name:marker,exact:true}).waitFor();
  let failNext=false,actualFailures=0;
  const faults=await trackedRoute(gui,'**/api/dsh.bot/command',async route=>{
    const payload=payloadFor(route.request());
    if(!failNext||payload?.action!=='material.search'||payload.input.botId!==botId||payload.input.query!==marker)return route.continue();
    failNext=false;
    const response=await route.fetch(),actual=(await response.json()).result;
    assert.equal(actual?.ok,true);assert.ok(actual.value.some(row=>row.docId===material.value.docId));
    actualFailures++;await route.abort('failed');
  });
  const query=async()=>{await search.getByLabel('关键词',{exact:true}).fill(marker);return uiRpc(gui,'material.search',()=>button(search,'搜索资料').click(),row=>row.input.botId===botId&&row.input.query===marker);};
  const failSearch=async()=>{
    failNext=true;await search.getByLabel('关键词',{exact:true}).fill(marker);
    const failed=gui.page.waitForEvent('requestfailed',{predicate:request=>{const row=payloadFor(request);return row?.action==='material.search'&&row.input.botId===botId&&row.input.query===marker;}});
    await Promise.all([button(search,'搜索资料').click(),failed]);
    await gui.page.getByRole('alert').filter({hasText:'connection'}).waitFor();faults.throwFailure();
  };
  let held,pending,primary;
  try {
    await failSearch();const recovered=await query();
    assert.ok(recovered.value.some(row=>row.docId===material.value.docId));
    assert.equal(await gui.page.getByRole('alert').count(),0,'A successful retry clears its own prior read failure');
    await failSearch();
    held=await holdReply(gui,'**/api/dsh.bot/command',row=>row?.payload?.action==='material.search'&&row.payload.input.botId===botId&&row.payload.input.query===marker);
    pending=observe(query());await held.ready();
    const editor=gui.card('收录资料');
    await editor.getByLabel('资料标题',{exact:true}).fill('V113_UNRELATED_WRITE_REJECTION');
    await editor.getByLabel('正文',{exact:true}).fill('x'.repeat(65537));
    const rejected=await uiRpc(gui,'material.ingest',()=>button(editor,'保存不可变资料').click(),row=>row.input.title==='V113_UNRELATED_WRITE_REJECTION','material_quota');
    const alert=gui.page.getByRole('alert').filter({hasText:'material_quota'});await alert.waitFor();
    const originalError=await alert.innerText(),operationId=rejected.request.operationId;
    assert.ok(operationId);assert.ok(originalError.includes(operationId));
    const original=gui.card('待查回的原始操作').locator('div.actions').filter({hasText:operationId});await original.waitFor();
    assert.equal(service.store.read().operations[operationId],undefined,'Rejected write must not acquire a committed receipt');
    await held.finish();await observed(pending);await paint(gui.page);
    assert.equal(await alert.innerText(),originalError,'Read retry cannot erase or rewrite the newer write failure');
    await original.waitFor();assert.equal(service.store.read().operations[operationId],undefined);
    assert.equal(actualFailures,2);assert.equal(failNext,false);
    await editor.getByLabel('正文',{exact:true}).fill('');
    gui.check('v113MaterialSearchRetryClearsOnlyItsOwnError',true);
  } catch(error) {primary=error;} finally {await cleanup(primary,[()=>held?.close(),()=>pending&&observed(pending),()=>faults.close()]);}
}

async function wildcardSharing(gui) {
  const service=gui.app.ctx.dshBot,source=service.store.read().bots[gui.botIds[0]],marker='V113_FUTURE_BOT_DEFAULT_READ';
  const owner=await command(gui,'bot.create',{name:'V113_DEFAULT_SHARED_OWNER',contact:source.contact});
  assert.deepEqual(owner.value.share.receivers,['*']);
  const memory=await command(gui,'memory.write',{botId:owner.value.botId,text:marker,category:'fact'});
  await gui.workbench('共享与授权');await button(gui.page,'刷新').click();
  const sharing=gui.card(`${owner.value.name} 的共享范围`);await sharing.waitFor();
  // Submit the existing form without changing any receiver checkbox.
  const saved=await uiRpc(gui,'share.set',()=>button(sharing,'保存共享上限').click(),row=>row.input.botId===owner.value.botId);
  assert.equal(saved.request.input.expectedVersion,owner.value.revision);
  assert.deepEqual(saved.request.input.share.receivers,['*']);assert.deepEqual(saved.value.receivers,['*']);
  const receipt=structuredClone(service.store.read().operations[saved.request.operationId]);
  assert.deepEqual(receipt.result.receivers,['*']);assert.deepEqual(service.store.read().bots[owner.value.botId].share.receivers,['*']);
  // Create the reader after Save, so a roster-expanded receiver list cannot pass.
  const future=await command(gui,'bot.create',{name:'V113_FUTURE_DEFAULT_READER',contact:source.contact});
  const session=await command(gui,'session.create',{botId:future.value.botId});
  const agent=gui.app.ctx.agents.get(session.value.sessionId);assert.ok(agent);
  const actor=service.policy.fromAgent(agent),hits=await service.dispatch(actor,{action:'memory.search',input:{botId:owner.value.botId,query:marker}});
  assert.ok(hits.some(row=>row.memoryId===memory.value.memoryId&&row.text===marker),'A real future native Bot must retain default read access');
  const receiver=sharing.locator(`input[name="receiver"][value="${future.value.botId}"]`);
  await receiver.waitFor();assert.equal(await receiver.isChecked(),true);
  assert.deepEqual(service.store.read().operations[saved.request.operationId],receipt,'A later reader cannot rewrite the original sharing receipt');
  gui.check('v113UntouchedSharingPreservesWildcardForFutureBotRead',true);
  return future.value.botId;
}

async function scheduleOwner(gui,ownerBotId) {
  const service=gui.app.ctx.dshBot;
  await gui.workbench('任务');await gui.expand(gui.card('新任务'),'提醒与定时');
  const pane=details(gui.card('新任务'),'提醒与定时');
  const createNew=button(pane,'创建新的安排');if(await createNew.count())await createNew.click();
  let editor=pane.locator('form').filter({has:button(gui.page,'确认创建安排')});
  assert.equal(await editor.getByLabel('负责 Bot',{exact:true}).isEnabled(),true);
  await editor.getByLabel('负责 Bot',{exact:true}).selectOption(ownerBotId);
  await editor.getByLabel('安排类型',{exact:true}).selectOption('reminder');
  await editor.getByLabel('提醒内容',{exact:true}).fill('V113_DISABLED_FUTURE_OWNER');
  await editor.getByLabel('频率',{exact:true}).selectOption('once');
  await editor.getByLabel('时区',{exact:true}).fill('UTC');
  await editor.getByLabel('当地日期',{exact:true}).fill('2099-10-10');
  await editor.getByLabel('当地时间',{exact:true}).fill('09:00');
  await editor.getByLabel('启用安排',{exact:true}).uncheck();
  const created=await uiRpc(gui,'schedule.create',()=>button(editor,'确认创建安排').click());
  assert.equal(created.request.input.ownerBotId,ownerBotId);assert.equal(created.value.ownerBotId,ownerBotId);
  assert.equal(created.value.enabled,false);assert.equal(created.value.nextDueAt,'2099-10-10T09:00:00.000Z');
  const receipt=structuredClone(service.store.read().operations[created.request.operationId]);
  editor=pane.locator('form').filter({has:button(gui.page,'重新确认并保存安排')});
  await waitFor(()=>editor.getByLabel('负责 Bot',{exact:true}).isDisabled(),'existing native schedule owner is read-only');
  assert.equal(await editor.getByLabel('负责 Bot',{exact:true}).inputValue(),ownerBotId);
  await editor.getByLabel('提醒内容',{exact:true}).fill('V113_DISABLED_FUTURE_OWNER_UPDATED');
  const updated=await uiRpc(gui,'schedule.update',()=>button(editor,'重新确认并保存安排').click());
  assert.equal(updated.request.input.ownerBotId,ownerBotId,'Disabled FormData control still preserves the immutable original owner');
  assert.equal(updated.request.input.expectedVersion,created.value.version);
  assert.equal(updated.value.ownerBotId,ownerBotId);assert.equal(updated.value.enabled,false);
  assert.equal(service.store.read().schedules[created.value.scheduleId].ownerBotId,ownerBotId);
  assert.deepEqual(service.store.read().operations[created.request.operationId],receipt);
  assert.equal(Object.values(service.store.read().occurrences).some(row=>row.scheduleId===created.value.scheduleId),false,'Disabled future reminder must never execute');
  await button(pane,'创建新的安排').click();
  editor=pane.locator('form').filter({has:button(gui.page,'确认创建安排')});
  assert.equal(await editor.getByLabel('负责 Bot',{exact:true}).isEnabled(),true);
  await editor.getByLabel('负责 Bot',{exact:true}).selectOption(gui.botIds[0]);
  assert.equal(await editor.getByLabel('负责 Bot',{exact:true}).inputValue(),gui.botIds[0]);
  gui.check('v113ScheduleOwnerReadOnlyOnEditAndSelectableOnCreate',true);
}

export async function runV113QualityChecks(gui) {
  const originalChecks=Object.keys(gui.report.checks).length;
  gui.report.v113Quality={realBrowser:true,actualInstalledNative:true,heldActualPeriodicSnapshot:true,actualNativePresetCatalogChange:true,actualMaterialTransportFailure:true,heldActualSearchReply:true,actualUnrelatedWriteRejection:true,actualFutureBotPolicyRead:true,disabledFutureReminder:true,apiCommands:0,uiCommands:0,originalChecksBeforeV113:originalChecks,coverage:{uiRegressionChecks:4,apiSetupOnly:true,externalModelRequests:0}};
  await forcedCatalogRefresh(gui);await materialRetry(gui);const futureBotId=await wildcardSharing(gui);await scheduleOwner(gui,futureBotId);
  gui.check('v113QualityUsesNoExternalModelRequests',gui.report.realModelRequests===0);
  gui.report.v113Quality.checksAdded=Object.keys(gui.report.checks).length-originalChecks;
  await gui.save('v113-native-quality');
}
