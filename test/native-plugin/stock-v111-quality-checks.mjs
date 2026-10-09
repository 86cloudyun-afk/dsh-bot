import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {controlledProvider,waitFor} from './stock-gui-runtime.mjs';

const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
const card=(gui,title)=>gui.page.locator('section.card').filter({has:gui.page.getByRole('heading',{name:title,level:2,exact:true})});
const digest=text=>createHash('sha256').update(text,'utf8').digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const paint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

async function uiRpc(gui,action,interact) {
  const responsePromise=gui.page.waitForResponse(response=>{
    try{return response.request().postDataJSON()?.payload?.action===action;}catch{return false;}
  });
  const [,response]=await Promise.all([interact(),responsePromise]);
  const request=response.request().postDataJSON().payload,reply=(await response.json()).result;
  assert.equal(reply?.ok,true,`${action}: ${reply?.error?.code}`);
  if(request.operationId)assert.ok(gui.app.ctx.dshBot.store.read().operations[request.operationId]);
  return {request,value:reply.value};
}

// Public authenticated RPC in the actual browser, with original command IDs.
async function command(gui,action,input,{operationId=crypto.randomUUID(),errorCode}={}) {
  gui.report.v111Quality.apiCommands++;
  const request={operationId,action,input};
  const reply=await gui.page.evaluate(async payload=>{
    const response=await fetch('/api/dsh.bot/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'dsh.bot/command',payload})});
    return (await response.json()).result;
  },request);
  if(errorCode){assert.equal(reply?.ok,false);assert.equal(reply.error.code,errorCode);}
  else assert.equal(reply?.ok,true,`${action}: ${reply?.error?.code}`);
  return {request,value:reply?.value,error:reply?.error};
}

async function uploads(gui) {
  await gui.workbench('记忆');
  await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(gui.botIds[0]);
  await button(gui.page,'资料').click();
  const ingest=card(gui,'收录资料'),textA='V111 earlier A\r\n',textB='\uFEFF# V111 latest B\r\nMixed\nexact bytes 🧭\r\n';
  await gui.page.evaluate(()=>{
    const original=File.prototype.arrayBuffer;
    window.__v111File={entered:false,released:false,completed:false};
    File.prototype.arrayBuffer=async function(){
      if(this.name==='v111-earlier-a.md'){
        window.__v111File.entered=true;
        await new Promise(resolve=>{window.__v111File.release=resolve;});
        window.__v111File.released=true;
        const bytes=await original.call(this);window.__v111File.completed=true;return bytes;
      }
      return original.call(this);
    };
    window.__v111File.restore=()=>{File.prototype.arrayBuffer=original;};
  });
  try {
    await ingest.getByLabel('UTF-8 文本或 Markdown 文件').setInputFiles({name:'v111-earlier-a.md',mimeType:'text/markdown',buffer:Buffer.from(textA)});
    await waitFor(()=>gui.page.evaluate(()=>window.__v111File.entered),'real first File.arrayBuffer is held');
    await ingest.getByRole('status').waitFor();
    assert.equal(await ingest.getByLabel('资料标题',{exact:true}).isEnabled(),false);
    assert.equal(await ingest.getByLabel('正文',{exact:true}).isEnabled(),false);
    assert.equal(await button(ingest,'保存不可变资料').isEnabled(),false);
    gui.check('v111PendingMaterialReadProtectsTitleBodyAndSaveIntent',true);
    await ingest.getByLabel('UTF-8 文本或 Markdown 文件').setInputFiles({name:'v111-latest-b.md',mimeType:'text/markdown',buffer:Buffer.from(textB)});
    await waitFor(async()=>await ingest.getByLabel('资料标题',{exact:true}).inputValue()==='v111-latest-b.md'&&await button(ingest,'保存不可变资料').isEnabled(),'latest actual file is ready while A remains held');
    const displayed=await ingest.getByLabel('正文',{exact:true}).inputValue();
    // Textarea normalizes CRLF but retains the decoded BOM, matching the old exact-byte checks.
    assert.equal(displayed,textB.replace(/\r\n?/g,'\n'));
    await gui.page.evaluate(()=>window.__v111File.release());
    await waitFor(()=>gui.page.evaluate(()=>window.__v111File.completed),'earlier original file bytes complete last');
    await paint(gui.page);
    assert.equal(await ingest.getByLabel('资料标题',{exact:true}).inputValue(),'v111-latest-b.md');
    assert.equal(await ingest.getByLabel('正文',{exact:true}).inputValue(),displayed);
    const rpc=await uiRpc(gui,'material.ingest',()=>button(ingest,'保存不可变资料').click());
    assert.equal(rpc.request.input.fileName,'v111-latest-b.md');
    assert.equal(rpc.request.input.mediaType,'text/markdown');
    assert.equal(rpc.request.input.text,textB);
    const stored=gui.app.ctx.dshBot.store.read().materials[rpc.value.docId];
    assert.equal(stored.fileName,'v111-latest-b.md');assert.equal(stored.mediaType,'text/markdown');
    assert.equal(stored.text,textB);assert.equal(stored.contentHash,digest(textB));
    assert.equal(rpc.value.contentHash,digest(textB));
    gui.check('v111LatestAcceptedFileWinsActualRpcAndStoredExactBytesSha256',true);
  } finally {
    await gui.page.evaluate(()=>{window.__v111File.release?.();window.__v111File.restore();delete window.__v111File;});
  }
}

async function memorySearch(gui) {
  await gui.workbench('记忆');
  const [botA,botB]=gui.botIds,markerA='V111_SEARCH_A_ONLY',markerB='V111_SEARCH_B_VISIBLE';
  for(const [botId,text] of [[botA,markerA],[botB,markerB]]){
    await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(botId);
    await button(gui.page,'长期记忆').click();
    await button(gui.page,'添加另一条记忆').click();
    const editor=card(gui,'添加记忆');await editor.getByLabel('内容',{exact:true}).fill(text);
    await uiRpc(gui,'memory.write',()=>button(editor,'保存到所选 Bot').click());
    await card(gui,'长期记忆').getByText(text,{exact:true}).waitFor();
  }
  await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(botA);
  const release=deferred(),completed=deferred();let actual;
  const gate=async route=>{
    const request=route.request().postDataJSON();
    if(request?.payload?.action!=='memory.search'||request.payload.input.botId!==botA)return route.continue();
    const response=await route.fetch();actual=(await response.json()).result;
    await release.promise;await route.fulfill({response});completed.resolve();
  };
  await gui.page.route('**/api/dsh.bot/command',gate);
  try {
    await card(gui,'长期记忆').getByLabel('内容关键词',{exact:true}).fill(markerA);
    const rpc=uiRpc(gui,'memory.search',()=>button(card(gui,'长期记忆'),'搜索记忆').click());
    await waitFor(()=>actual!==undefined,'actual native memory-search response is held');
    assert.equal(actual.ok,true);assert.ok(actual.value.some(row=>gui.app.ctx.dshBot.store.read().memories[row.memoryId]?.text===markerA));
    await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(botB);
    await card(gui,'长期记忆').getByText(markerB,{exact:true}).waitFor();
    release.resolve();await completed.promise;await rpc;await paint(gui.page);
    assert.equal(await gui.page.getByLabel('所属 Bot',{exact:true}).inputValue(),botB);
    assert.equal(await card(gui,'长期记忆').getByText(markerB,{exact:true}).count(),1);
    assert.equal(await button(gui.page,'显示全部记忆').count(),0);
    gui.check('v111HeldActualBotAMemorySearchCannotReplaceBotBVisibleMemory',true);
  } finally {release.resolve();await gui.page.unroute('**/api/dsh.bot/command',gate);}
}

const once=at=>{const iso=new Date(at).toISOString();return {kind:'once',timezone:'UTC',date:iso.slice(0,10),time:iso.slice(11,16)};};
async function scheduleCorrection(gui) {
  const service=gui.app.ctx.dshBot,assistant=service.assistant,originalNow=assistant.clock.now;
  let now=Math.ceil(Date.now()/60000)*60000;assistant.clock.now=()=>now;
  try {
    const botId=gui.botIds[0],oldDue=now+60000,newDue=oldDue+60000;
    const created=await command(gui,'schedule.create',{ownerBotId:botId,kind:'task',recipe:{botId,title:'V111_CORRECTED_SCHEDULE',goal:'GUI_SHORT V111 actual corrected schedule',criteria:[],originSessionId:gui.contactId},rule:once(oldDue)});
    const bot=service.store.read().bots[botId];
    await command(gui,'bot.update',{botId,expectedVersion:bot.revision,executionMode:'explicit',execution:{provider:controlledProvider,model:bot.execution.model==='model-b'?'model-a':'model-b'}});
    now=oldDue;await assistant.runDue();
    const blocked=structuredClone(Object.values(service.store.read().occurrences).find(row=>row.scheduleId===created.value.scheduleId));
    assert.ok(blocked);assert.equal(blocked.state,'blocked');
    assert.equal(service.store.read().schedules[created.value.scheduleId].pauseReason,'schedule_config_changed');
    assert.equal(blocked.attemptId??null,null);assert.equal(blocked.taskId??null,null);
    const requestCount=gui.report.requests.length,receiptBefore=structuredClone(service.store.read().operations[created.request.operationId]);
    now=oldDue+10000;
    const updated=await command(gui,'schedule.update',{scheduleId:created.value.scheduleId,expectedVersion:service.store.read().schedules[created.value.scheduleId].version,enabled:true,rule:once(newDue)});
    assert.ok(now-oldDue<60000);await assistant.runDue();
    let state=service.store.read(),retired=state.occurrences[blocked.occurrenceId];
    assert.equal(state.schedules[created.value.scheduleId].enabled,true);
    assert.equal(state.schedules[created.value.scheduleId].pauseReason,undefined);
    for(const key of ['occurrenceId','dueAt','createOperationId','startOperationId','consentVersion'])assert.deepEqual(retired[key],blocked[key]);
    assert.equal(retired.attemptId??null,null);assert.equal(retired.taskId??null,null);
    assert.deepEqual(state.operations[created.request.operationId],receiptBefore);
    assert.equal(gui.report.requests.length,requestCount);
    now=newDue;await assistant.runDue();
    await waitFor(()=>{
      const current=service.store.read(),row=Object.values(current.occurrences).find(row=>row.scheduleId===created.value.scheduleId&&row.dueAt===new Date(newDue).toISOString());
      return row?.attemptId&&current.attempts[row.attemptId]?.result&&!current.attempts[row.attemptId].reservationHeld&&Object.values(current.outbox).some(out=>out.attemptId===row.attemptId&&out.state==='accepted');
    },'new actual schedule native result and original accepted delivery');
    await assistant.runDue();state=service.store.read();
    const occurrences=Object.values(state.occurrences).filter(row=>row.scheduleId===created.value.scheduleId),fresh=occurrences.find(row=>row.occurrenceId!==blocked.occurrenceId);
    assert.equal(occurrences.length,2);assert.equal(fresh.consentVersion,updated.value.consentVersion);
    assert.equal(Object.values(state.attempts).filter(row=>row.taskId===fresh.taskId).length,1);
    assert.equal(state.occurrences[blocked.occurrenceId].attemptId??null,null);
    assert.equal(state.operations[blocked.createOperationId],undefined);
    assert.equal(state.operations[blocked.startOperationId],undefined);
    assert.deepEqual(state.operations[created.request.operationId],receiptBefore);
    assert.ok(state.operations[updated.request.operationId]);assert.ok(state.operations[fresh.createOperationId]);assert.ok(state.operations[fresh.startOperationId]);
    const attempt=state.attempts[fresh.attemptId];
    assert.equal(gui.report.requests.filter(row=>row.sessionId===attempt.sessionId&&row.purpose==='conversation'&&row.finish==='stop').length,1);
    assert.ok((await gui.original(gui.contactId)).some(row=>row.type==='user/message'&&row.data.id===attempt.resultMessageId));
    gui.check('v111ScheduleReconfirmationWithinOriginalDeadlineRetiresOnlyUnadmittedOldTrigger',true);
    gui.check('v111CorrectedFutureTriggerRunsOnceWithActualNativeResultAndOriginalReceipts',true);
  } finally {assistant.clock.now=originalNow;await assistant.runDue();}
}

async function configureArchive(gui) {
  const service=gui.app.ctx.dshBot,sessionId=gui.contactId;
  await waitFor(()=>{
    const agent=gui.app.ctx.agents.get(sessionId);
    return service.adapter.resources(sessionId).settled&&(!agent||!agent.inbox.nextTurn.length&&!agent.inbox.nextStep.length);
  },'actual native contact is settled before configure barrier');
  const originalConfigure=service.adapter.configureOwned,registry=service.adapter.context.get('workspaceRegistry'),originalArchive=registry.archiveSession,originalRestore=registry.unarchiveSession;
  const release=deferred();let nativeCalls=0,archiveCalls=0;
  service.adapter.configureOwned=async function(...args){nativeCalls++;await release.promise;return originalConfigure.apply(this,args);};
  registry.archiveSession=async function(...args){archiveCalls++;return originalArchive.apply(this,args);};
  registry.unarchiveSession=async function(...args){archiveCalls++;return originalRestore.apply(this,args);};
  let configured;
  try {
    const old=service.store.read().sessions[sessionId],operationId=crypto.randomUUID();
    configured=command(gui,'session.configure',{sessionId,expectedVersion:old.revision,name:'V111_CONFIGURE_ORIGINAL_BARRIER'},{operationId});
    await waitFor(()=>service.store.read().sessions[sessionId].state==='configuring','original durable configuration is pending at native adapter');
    assert.equal(nativeCalls,1);const before=structuredClone(service.store.read());
    for(const action of ['session.archive','session.restore']){
      const rejected=await command(gui,action,{sessionId},{errorCode:'operation_pending'});
      assert.equal(service.store.read().operations[rejected.request.operationId],undefined);
      assert.equal(service.store.read().revision,before.revision);assert.equal(archiveCalls,0);
    }
    release.resolve();const result=await configured;
    assert.equal(nativeCalls,1);assert.equal(result.value.state,'ready');assert.equal(result.value.revision,old.revision+1);
    const state=service.store.read(),intent=state.operations[operationId];
    assert.deepEqual(state.operations[intent.result.statusOperationId].result,result.value);
    const native=await service.adapter.readNative(sessionId);
    assert.ok(native.events.some(row=>row.type==='session/title'&&row.data.title==='V111_CONFIGURE_ORIGINAL_BARRIER'));
    assert.equal(state.sessions[sessionId].archived,false);
    gui.check('v111PendingConfigureRejectsArchiveRestoreBeforeDurableOrNativeSideEffects',true);
    gui.check('v111OriginalConfigureSettlesNativeTitleAndExactFinalReceiptOnce',true);
  } finally {
    release.resolve();
    try {if(configured)await configured;}
    finally {service.adapter.configureOwned=originalConfigure;registry.archiveSession=originalArchive;registry.unarchiveSession=originalRestore;}
  }
}

export async function runV111QualityChecks(gui) {
  const originalChecks=Object.keys(gui.report.checks).length;
  gui.report.v111Quality={realBrowser:true,actualInstalledNative:true,heldActualFileRead:true,heldActualSearchResponse:true,controlledTriggerClock:true,apiCommands:0,originalChecksBeforeV111:originalChecks};
  await uploads(gui);await memorySearch(gui);await scheduleCorrection(gui);await configureArchive(gui);
  gui.check('v111QualityUsesNoExternalModelRequests',gui.report.realModelRequests===0);
  gui.report.v111Quality.checksAdded=Object.keys(gui.report.checks).length-originalChecks;
  await gui.save('v111-native-quality');
}
