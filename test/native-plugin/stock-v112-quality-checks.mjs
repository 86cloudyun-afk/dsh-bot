import assert from 'node:assert/strict';
import {waitFor} from './stock-gui-runtime.mjs';

const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
const card=(gui,title)=>gui.card(title);
const details=(page,title)=>page.locator('details').filter({has:page.locator('summary').filter({hasText:new RegExp(`^${title}$`)})});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const paint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const requestFor=(response,action)=>{try{return response.request().postDataJSON()?.payload?.action===action;}catch{return false;}};

async function uiRpc(gui,action,interact,accept=()=>true) {
  gui.report.v112Quality.uiCommands++;
  const responsePromise=gui.page.waitForResponse(response=>requestFor(response,action)&&accept(response.request().postDataJSON().payload));
  const [,response]=await Promise.all([interact(),responsePromise]);
  const request=response.request().postDataJSON().payload,reply=(await response.json()).result;
  assert.equal(reply?.ok,true,`${action}: ${reply?.error?.code}`);
  if(request.operationId)assert.ok(gui.app.ctx.dshBot.store.read().operations[request.operationId]);
  if(request.operationId)await waitFor(()=>button(gui.page,'刷新').isEnabled(),`${action} original UI command finished refreshing`);
  return {request,value:reply.value};
}
async function command(gui,action,input) {
  gui.report.v112Quality.apiCommands++;
  const request={operationId:crypto.randomUUID(),action,input};
  const reply=await gui.page.evaluate(async payload=>{
    const response=await fetch('/api/dsh.bot/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'dsh.bot/command',payload})});
    return (await response.json()).result;
  },request);
  assert.equal(reply?.ok,true,`${action}: ${reply?.error?.code}`);
  if(gui.app.ctx.dshBot.store.read().operations[request.operationId])assert.ok(gui.app.ctx.dshBot.store.read().operations[request.operationId].result);
  return {request,value:reply.value};
}

// Intercept only the delivery of one genuine native reply, preserving its body.
async function holdReply(gui,path,accept=()=>true) {
  const release=deferred(),completed=deferred(),active=new Set(),failures=[];let actual,request,claimed=false;
  const throwFailure=()=>{if(failures.length===1)throw failures[0];if(failures.length>1)throw new AggregateError(failures,'Held actual reply lifecycle failed');};
  const route=async route=>{
    let selected=false;
    const work=(async()=>{
      const envelope=route.request().postDataJSON();
      if(claimed||!accept(envelope))return route.continue();
      selected=true;claimed=true;request=envelope;
      const response=await route.fetch();actual=(await response.json()).result;
      assert.ok(actual&&typeof actual==='object','Actual held RPC response must include its result');
      await release.promise;
      await route.fulfill({response});
    })();
    active.add(work);
    // Playwright dispatches handlers without an awaitable public callback promise.
    // Retain failures here and throw them through ready/finish/close to the runner.
    try {await work;} catch(error) {failures.push(error);}
    finally {active.delete(work);if(selected)completed.resolve();}
  };
  await gui.page.route(path,route);
  return {get actual(){return actual;},get request(){return request;},release:()=>release.resolve(),
    async ready(){await waitFor(()=>actual!==undefined||failures.length,'held actual installed reply');throwFailure();assert.equal(actual.ok,true);},
    async finish(){assert.ok(claimed,'A genuine reply must be selected before finishing');release.resolve();await completed.promise;throwFailure();await paint(gui.page);},
    async close(){release.resolve();while(active.size)await Promise.allSettled([...active]);await gui.page.unroute(path,route);throwFailure();}};
}

async function memoryCancel(gui) {
  const service=gui.app.ctx.dshBot,botId=gui.botIds[0];
  const saved=await command(gui,'memory.write',{botId,text:'V112_IMPORT_ORIGINAL_EXPORT',category:'fact'});
  const exported=await command(gui,'memory.export',{botId,memoryIds:[saved.value.memoryId]});
  const fileA=exported.value.fileText,fileB=JSON.stringify({...JSON.parse(fileA),entries:JSON.parse(fileA).entries.map(row=>({...row,text:'V112_IMPORT_REPLACEMENT_UNCONFIRMED'}))});
  await gui.workbench('记忆');await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(botId);
  await button(gui.page,'长期记忆').click();await gui.expand(card(gui,'长期记忆'),'导入导出');
  const transfer=details(gui.page,'导入导出'),actions=[];
  const observe=request=>{try{const payload=request.postDataJSON()?.payload;if(payload?.action?.startsWith('memory.import'))actions.push(payload);}catch{}};
  gui.page.on('request',observe);
  await gui.page.evaluate(()=>{
    const original=File.prototype.arrayBuffer;
    window.__v112File={entered:false,completed:false};
    File.prototype.arrayBuffer=async function(){
      if(this.name==='v112-held-replacement.json'){
        window.__v112File.entered=true;
        await new Promise(resolve=>{window.__v112File.release=resolve;});
        const bytes=await original.call(this);window.__v112File.completed=true;return bytes;
      }
      return original.call(this);
    };
    window.__v112File.restore=()=>{File.prototype.arrayBuffer=original;};
  });
  try {
    const preview=await uiRpc(gui,'memory.import.preview',()=>transfer.getByLabel('导入 JSON 文件').setInputFiles({name:'v112-original.json',mimeType:'application/json',buffer:Buffer.from(fileA)}));
    assert.equal(preview.request.input.fileText,fileA);
    await button(transfer,'确认整批追加').waitFor();
    const memoriesBefore=structuredClone(service.store.read().memories),operationsBefore=structuredClone(service.store.read().operations);
    await transfer.getByLabel('导入 JSON 文件').setInputFiles({name:'v112-held-replacement.json',mimeType:'application/json',buffer:Buffer.from(fileB)});
    await waitFor(()=>gui.page.evaluate(()=>window.__v112File.entered),'actual replacement memory File.arrayBuffer is held');
    const confirm=button(transfer,'确认整批追加');
    assert.ok(await confirm.count()===0||!await confirm.isEnabled(),'old preview cannot be confirmed during newer file read');
    gui.check('v112PendingMemoryReplacementDisablesStaleConfirmation',true);
    await button(transfer,'取消导入').click();
    await gui.page.evaluate(()=>window.__v112File.release());
    await waitFor(()=>gui.page.evaluate(()=>window.__v112File.completed),'canceled original bytes completed');await paint(gui.page);
    assert.equal(await button(transfer,'确认整批追加').count(),0);
    assert.equal(await transfer.getByLabel('导入 JSON 文件').isEnabled(),true);
    assert.equal(actions.filter(row=>row.action==='memory.import').length,0);
    assert.equal(actions.filter(row=>row.action==='memory.import.preview').length,1,'canceled read must not launch another preview');
    assert.deepEqual(service.store.read().memories,memoriesBefore);
    assert.deepEqual(service.store.read().operations,operationsBefore);
    gui.check('v112CanceledHeldMemoryReadCannotRestorePreviewOrIssueImport',true);
  } finally {
    gui.page.off('request',observe);
    await gui.page.evaluate(()=>{window.__v112File.release?.();window.__v112File.restore();delete window.__v112File;});
  }
}

async function materialSearch(gui) {
  const botId=gui.botIds[0],a='V112ALPHASEARCHONLY',b='V112BETASEARCHONLY';
  for(const marker of [a,b])await command(gui,'material.ingest',{botId,title:marker,text:`# ${marker}\nExact actual installed search result ${marker}`,mediaType:'text/markdown'});
  await gui.workbench('记忆');await button(gui.page,'刷新').click();await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(botId);await button(gui.page,'资料').click();
  const search=card(gui,'资料检索');
  await search.getByRole('heading',{name:a,exact:true}).waitFor();await search.getByRole('heading',{name:b,exact:true}).waitFor();
  const query=async text=>{await search.getByLabel('关键词',{exact:true}).fill(text);return uiRpc(gui,'material.search',()=>button(search,'搜索资料').click(),row=>row.input.query===text);};
  let held=await holdReply(gui,'**/api/dsh.bot/command',row=>row?.payload?.action==='material.search'&&row.payload.input.query===a),earlier;
  try {
    earlier=query(a);await held.ready();assert.ok(held.actual.value.some(row=>row.title===a));
    const latest=await query(b);assert.ok(latest.value.some(row=>row.title===b));
    await search.getByRole('heading',{name:b,exact:true}).waitFor();
    assert.equal(await search.getByRole('heading',{name:a,exact:true}).count(),0);
    await held.finish();await earlier;await paint(gui.page);
    assert.equal(await search.getByRole('heading',{name:b,exact:true}).count(),1);
    assert.equal(await search.getByRole('heading',{name:a,exact:true}).count(),0);
    gui.check('v112OutOfOrderActualMaterialRepliesKeepLatestSearch',true);
  } finally {await held.close();if(earlier)await earlier;}
  held=await holdReply(gui,'**/api/dsh.bot/command',row=>row?.payload?.action==='material.search'&&row.payload.input.query===a);earlier=undefined;
  try {
    earlier=query(a);await held.ready();await button(search,'显示全部资料').click();
    await search.getByRole('heading',{name:a,exact:true}).waitFor();await search.getByRole('heading',{name:b,exact:true}).waitFor();
    await held.finish();await earlier;await paint(gui.page);
    assert.equal(await search.getByRole('heading',{name:a,exact:true}).count(),1);
    assert.equal(await search.getByRole('heading',{name:b,exact:true}).count(),1);
    assert.equal(await button(search,'显示全部资料').count(),0);
    gui.check('v112ShowAllMaterialsInvalidatesHeldActualSearch',true);
  } finally {await held.close();if(earlier)await earlier;}
}

async function catalogHistory(gui) {
  const service=gui.app.ctx.dshBot,source=service.store.read().bots[gui.botIds[0]];
  const created=await command(gui,'bot.create',{name:'V112_CATALOG_ORIGINAL_RECEIPT',contact:source.contact});
  await gui.workbench('Bots');await button(gui.page,'刷新').click();
  await gui.page.getByRole('heading',{name:created.value.name,exact:true}).waitFor();
  let original,receipt;
  const lost=async route=>{
    const payload=route.request().postDataJSON()?.payload;
    if(payload?.action!=='bot.update'||payload.input.botId!==created.value.botId||original)return route.continue();
    original=payload;
    const response=await route.fetch(),actual=(await response.json()).result;
    assert.equal(actual.ok,true);receipt=structuredClone(service.store.read().operations[payload.operationId]);assert.ok(receipt);
    await route.abort('failed');
  };
  const held=await holdReply(gui,'**/api/dsh.bot/catalog');
  await gui.page.route('**/api/dsh.bot/command',lost);
  try {
    await button(gui.page,'刷新').click();await held.ready();
    await gui.expand(card(gui,created.value.name),'状态管理');
    await button(card(gui,created.value.name),'暂停').click();
    await gui.page.getByRole('alert').filter({hasText:'结果未确认'}).waitFor();
    assert.ok(original?.operationId);const pending=card(gui,'待查回的原始操作').locator('div.actions').filter({hasText:original.operationId});
    await pending.waitFor();await held.finish();
    await pending.waitFor();assert.deepEqual(service.store.read().operations[original.operationId],receipt);
    gui.check('v112CatalogRefreshPreservesNewPendingOriginalOperation',true);
  } finally {await held.close();await gui.page.unroute('**/api/dsh.bot/command',lost);}
  const retained=await holdReply(gui,'**/api/dsh.bot/catalog');
  try {
    await button(gui.page,'刷新').click();await retained.ready();
    const pending=card(gui,'待查回的原始操作').locator('div.actions').filter({hasText:original.operationId});
    await button(pending,'保留并收起').click();await pending.waitFor({state:'hidden'});
    await retained.finish();
    const history=details(gui.page,'保留的原始操作');
    await history.locator('small').filter({hasText:original.operationId}).waitFor({state:'attached'});
    assert.equal(await pending.count(),0);
    const cache=await gui.page.evaluate(storeId=>JSON.parse(localStorage.getItem(`dsh-bot.pending.v1.${storeId}.retained`)??'[]'),service.store.read().storeId);
    assert.deepEqual(cache.find(row=>row.operationId===original.operationId),original);
    assert.deepEqual(service.store.read().operations[original.operationId],receipt);
    gui.check('v112CatalogRefreshPreservesRetainedOriginalOperationHistory',true);
  } finally {await retained.close();}
  return original.operationId;
}

async function diagnostics(gui,operationId) {
  await gui.workbench('会话管理');
  await gui.page.getByLabel('附带的原始操作（可多选）').waitFor({state:'attached'});
  const diagnostic=details(gui.page,'诊断');await gui.expand(card(gui,'原生会话管理'),'诊断');
  const selection=diagnostic.getByLabel('附带的原始操作（可多选）');await selection.selectOption([operationId]);
  const held=await holdReply(gui,'**/api/dsh.bot/command',row=>row?.payload?.action==='diagnostics.read');let pending;
  try {
    pending=uiRpc(gui,'diagnostics.read',()=>button(diagnostic,'预览诊断').click());await held.ready();
    assert.deepEqual(held.request.payload.input.operationIds,[operationId]);
    assert.deepEqual(held.actual.value.operationIds,[operationId]);
    await selection.selectOption([]);await held.finish();await pending;await paint(gui.page);
    assert.equal(await button(diagnostic,'复制以上诊断').count(),0);
    assert.equal(await diagnostic.locator('pre').count(),0);
    gui.check('v112ChangedDiagnosticSelectionCannotReviveHeldActualPreview',true);
  } finally {await held.close();if(pending)await pending;}
}

async function runningNoop(gui) {
  const service=gui.app.ctx.dshBot;
  await gui.workbench('任务');
  const editor=card(gui,'新任务');await editor.getByLabel('负责人',{exact:true}).selectOption(gui.botIds[0]);
  await editor.getByLabel('标题',{exact:true}).fill('V112_RUNNING_NOOP_ORIGINAL');await editor.getByLabel('目标',{exact:true}).fill('GUI_SHORT V112_RUNNING_NOOP_ORIGINAL');
  await gui.expand(editor,'验收与结果接收');await editor.getByLabel('结果接收会话',{exact:true}).selectOption(gui.contactId);
  const created=await uiRpc(gui,'task.create',()=>button(editor,'登记任务').click()),taskId=created.value.taskId;
  const release=deferred();let entered=false,signal,sessionId;
  const dispose=gui.app.ctx.on('llm/stream',async function* (options,next){
    const binding=service.store.read().sessions[options.sessionId],target=binding?.attemptId&&service.store.read().attempts[binding.attemptId]?.taskId===taskId;
    for await(const chunk of next()){
      if(target&&chunk.type==='finish'&&(options.purpose??'conversation')==='conversation'){
        entered=true;signal=options.signal;sessionId=options.sessionId;
        const aborted=deferred(),onAbort=()=>aborted.resolve();signal.addEventListener('abort',onAbort,{once:true});
        try{await Promise.race([release.promise,aborted.promise]);signal.throwIfAborted();}finally{signal.removeEventListener('abort',onAbort);}
      }
      yield chunk;
    }
  },{global:true});
  try {
    const started=await uiRpc(gui,'task.start',()=>button(card(gui,created.value.title),'开始／接续').click());
    await waitFor(()=>entered,'actual original native provider finish held');
    const before=structuredClone(service.store.read().tasks[taskId]),attempt=structuredClone(service.store.read().attempts[before.currentAttemptId]);
    assert.equal(attempt.state,'running');assert.equal(attempt.sessionId,sessionId);assert.equal(attempt.reservationHeld,true);
    assert.equal(gui.report.requests.filter(row=>row.sessionId===sessionId&&row.purpose==='conversation').length,1);
    assert.equal(signal.aborted,false);const startReceipt=structuredClone(service.store.read().operations[started.request.operationId]);
    await gui.expand(card(gui,created.value.title),'调整与接续');
    await button(card(gui,created.value.title),'重新载入最新任务').click();
    assert.equal(await card(gui,created.value.title).getByLabel('新目标',{exact:true}).inputValue(),before.goal);
    const adjusted=await uiRpc(gui,'task.adjust',()=>button(card(gui,created.value.title),'调整目标').click());
    assert.equal(adjusted.request.input.expectedVersion,before.version);assert.equal(adjusted.request.input.goal,before.goal);
    assert.deepEqual(adjusted.value,before);assert.deepEqual(service.store.read().tasks[taskId],before);
    assert.equal(service.store.read().attempts[attempt.attemptId].state,'running');assert.equal(signal.aborted,false);
    const adjustReceipt=structuredClone(service.store.read().operations[adjusted.request.operationId]);
    release.resolve();await waitFor(()=>{
      const state=service.store.read(),row=state.attempts[attempt.attemptId];
      return row?.result&&!row.reservationHeld&&Object.values(state.outbox).some(out=>out.attemptId===attempt.attemptId&&out.state==='accepted');
    },'original native result and original accepted delivery after noop');
    const state=service.store.read(),settled=state.attempts[attempt.attemptId];
    assert.equal(settled.state,'returned');assert.equal(state.tasks[taskId].state,'awaiting_acceptance');
    assert.equal(state.tasks[taskId].currentAttemptId,attempt.attemptId);assert.equal(state.tasks[taskId].epoch,before.epoch);
    assert.equal(state.tasks[taskId].definitionVersion,before.definitionVersion);
    assert.equal(Object.values(state.attempts).filter(row=>row.taskId===taskId).length,1);
    assert.equal(gui.report.requests.filter(row=>row.sessionId===sessionId&&row.purpose==='conversation').length,1);
    assert.deepEqual(state.operations[started.request.operationId],startReceipt);assert.deepEqual(state.operations[adjusted.request.operationId],adjustReceipt);
    assert.ok((await gui.original(gui.contactId)).some(row=>row.type==='user/message'&&row.data.id===settled.resultMessageId));
    gui.check('v112RunningNoopAdjustmentPreservesOriginalNativeResultAndReceipt',true);
  } finally {release.resolve();dispose();}
}

export async function runV112QualityChecks(gui) {
  const originalChecks=Object.keys(gui.report.checks).length;
  gui.report.v112Quality={realBrowser:true,actualInstalledNative:true,heldActualFileRead:true,heldActualSearchResponse:true,heldActualDiagnosticsResponse:true,heldActualCatalogResponse:true,heldActualNativeFinish:true,apiCommands:0,uiCommands:0,originalChecksBeforeV112:originalChecks,coverage:{uiReadIntentChecks:7,nativeExecutionChecks:1,apiSetupOnly:true,optionalLifecycleCases:'focused official SDK tests; no installed GUI claim'}};
  await memoryCancel(gui);await materialSearch(gui);const operationId=await catalogHistory(gui);await diagnostics(gui,operationId);await runningNoop(gui);
  gui.check('v112QualityUsesNoExternalModelRequests',gui.report.realModelRequests===0);
  gui.report.v112Quality.checksAdded=Object.keys(gui.report.checks).length-originalChecks;
  await gui.save('v112-native-quality');
}
