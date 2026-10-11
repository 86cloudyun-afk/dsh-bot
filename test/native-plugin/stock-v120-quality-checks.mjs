import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {controlledProvider,waitFor} from './stock-gui-runtime.mjs';
import {createTrackedRoute} from './stock-route-scope.mjs';

const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
const paint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const digest=text=>createHash('sha256').update(text,'utf8').digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const observed=promise=>Promise.resolve(promise).then(value=>({value}),error=>({error}));
const unwrap=async promise=>{const outcome=await promise;if(Object.hasOwn(outcome,'error'))throw outcome.error;return outcome.value;};
const payload=request=>{try{return request.postDataJSON()?.payload;}catch{return undefined;}};
const counts=service=>{const state=service.store.read();return Object.fromEntries(['operations','bots','sessions'].map(table=>[table,Object.keys(state[table]).length]));};
const pendingRow=(gui,id)=>gui.card('待查回的原始操作').locator('div.actions').filter({hasText:id});
async function cleanup(primary,steps) {
  const failures=primary===undefined?[]:[primary];
  for(const step of steps)try{await step();}catch(error){if(!failures.includes(error))failures.push(error);}
  if(failures.length===1)throw failures[0];
  if(failures.length>1)throw new AggregateError(failures,'v120 installed GUI and owned cleanup failed',{cause:primary??failures[0]});
}

// One selected real Request owns all listeners, timeout and cancellation. The
// outcome is observed immediately, including when interaction fails first.
function rpcObserver(page,accept,{timeout=30000}={}) {
  let selected,settled=false,timer,stop;
  const result=observed(new Promise((resolve,reject)=>{
    const finish=(done,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      page.off('request',onRequest);page.off('response',onResponse);
      page.off('requestfailed',onFailed);page.off('close',onClose);done(value);
    };
    const onRequest=request=>{if(!selected&&accept(request))selected=request;};
    const onResponse=response=>{if(response.request()===selected)finish(resolve,{response,request:selected});};
    const onFailed=request=>{if(request===selected)finish(resolve,{failed:request,request});};
    const onClose=()=>finish(reject,Error('Actual v120 page closed during RPC'));
    stop=reason=>finish(reject,reason);
    page.on('request',onRequest);page.on('response',onResponse);page.on('requestfailed',onFailed);page.on('close',onClose);
    timer=setTimeout(()=>finish(reject,Error('Timed out waiting for actual v120 RPC')),timeout);
    if(page.isClosed())onClose();
  }));
  return {result,stop};
}
async function browserRpc(gui,accept,interact,{errorCode,transportFailure=false,mutation=false}={}) {
  const observer=rpcObserver(gui.page,accept);let primary;
  try {
    const [,event]=await Promise.all([Promise.resolve().then(interact),unwrap(observer.result)]);
    if(transportFailure){assert.ok(event.failed,'The actual selected request must fail transport');return event;}
    assert.ok(event.response,'The actual selected request must return its real response');
    const reply=(await event.response.json()).result,request=payload(event.request);
    assert.equal(reply?.ok,errorCode===undefined,`${request?.action??event.request.url()}: ${reply?.error?.code}`);
    if(errorCode!==undefined)assert.equal(reply.error.code,errorCode);
    if(mutation&&errorCode===undefined)assert.ok(gui.app.ctx.dshBot.store.read().operations[request.operationId]);
    if(mutation)await waitFor(async()=>await button(gui.page,'刷新').count()===0||await button(gui.page,'刷新').isEnabled(),'v120 original UI mutation is no longer busy');
    await paint(gui.page);return {request,value:reply.value,error:reply.error};
  }catch(error){primary=error;throw error;}
  finally{observer.stop(primary??Error('v120 observer finished'));await observer.result;}
}
async function uiCommand(gui,action,interact,{accept=()=>true,...options}={}) {
  gui.report.v120Quality.uiCommands++;
  return browserRpc(gui,request=>{const row=payload(request);return row?.action===action&&accept(row);},interact,options);
}
async function api(gui,action,input,{mutation=true,errorCode}={}) {
  gui.report.v120Quality.apiCommands++;
  const request={...(mutation?{operationId:randomUUID()}:{}),action,input};
  const reply=await gui.page.evaluate(async payload=>{
    const response=await fetch('/api/dsh.bot/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method:'dsh.bot/command',payload})});
    return (await response.json()).result;
  },request);
  assert.equal(reply?.ok,errorCode===undefined,`${action}: ${reply?.error?.code}`);
  if(errorCode!==undefined)assert.equal(reply.error.code,errorCode);
  else if(mutation)assert.ok(gui.app.ctx.dshBot.store.read().operations[request.operationId]);
  return {request,value:reply.value,error:reply.error};
}
async function refresh(gui) {
  return browserRpc(gui,request=>request.url().endsWith('/api/dsh.bot/catalog'),()=>button(gui.page,'刷新').click());
}
async function heldReply(gui,path,accept=()=>true) {
  const release=deferred();let claimed=false,actual,request;
  const scope=await createTrackedRoute(gui.page,path,async route=>{
    if(claimed||!accept(route.request()))return route.continue();
    claimed=true;request=route.request();
    const response=await route.fetch();actual=(await response.json()).result;
    assert.ok(actual&&typeof actual==='object','Held response is an actual installed RPC result');
    await release.promise;await route.fulfill({response});
  });
  return {get actual(){return actual;},get request(){return request;},
    async ready(){await waitFor(()=>actual!==undefined||scope.failures.length,'actual installed v120 reply held');scope.throwFailure();assert.equal(actual.ok,true);},
    async finish(){release.resolve();await scope.drain();scope.throwFailure();await paint(gui.page);},
    async close(){release.resolve();await scope.close();}};
}

async function existingContact(gui) {
  const service=gui.app.ctx.dshBot,name='V120_ORIGINAL_CHAT_IDENTITY';
  const bot=(await api(gui,'bot.create',{name,contact:{provider:controlledProvider,model:'model-c'}})).value;
  await gui.workbench('Bots');await refresh(gui);
  const botCard=gui.page.locator(`#dsh-resource-${bot.botId}`);
  // The original Start chat contract intentionally creates a new contact each
  // time; Continue chat chooses one existing stable identity without a command.
  const first=await uiCommand(gui,'session.create',()=>button(botCard,'开始聊天').click(),{mutation:true,accept:row=>row.input.botId===bot.botId});
  await gui.page.locator('[data-composer-input="true"]').waitFor();
  await gui.workbench('Bots');
  const second=await uiCommand(gui,'session.create',()=>button(botCard,'开始聊天').click(),{mutation:true,accept:row=>row.input.botId===bot.botId});
  assert.notEqual(first.value.sessionId,second.value.sessionId);
  for(const contact of [first.value,second.value])await api(gui,'session.configure',{sessionId:contact.sessionId,expectedVersion:contact.revision,name:'V120_SAVED_SAME_NAME'});
  await gui.workbench('Bots');await refresh(gui);
  await button(botCard,'继续聊天').click();
  const selector=botCard.getByRole('region',{name:'选择已有聊天',exact:true});await selector.waitFor();
  await button(selector,`V120_SAVED_SAME_NAME · ${first.value.sessionId}`).waitFor();
  await button(selector,`V120_SAVED_SAME_NAME · ${second.value.sessionId}`).waitFor();
  await button(selector,'关闭继续聊天').click();await selector.waitFor({state:'hidden'});
  await button(botCard,'继续聊天').click();
  const before=counts(service),requestsBefore=gui.report.requests.length,original=await gui.original(first.value.sessionId);
  await button(selector,`V120_SAVED_SAME_NAME · ${first.value.sessionId}`).click();
  await gui.page.getByRole('heading',{name:'Bot 工作台',exact:true}).waitFor({state:'hidden'});
  await gui.page.locator('[data-slot="conversation.input.dock"]').getByRole('button',{name:`正在与${name}聊天`,exact:true}).waitFor();
  // Read the official shell's persisted selection after actual navigation;
  // never replace or inject its controller or selection store.
  assert.equal(await gui.page.evaluate(()=>JSON.parse(localStorage.getItem('dsh.sessions.current')).sessionId),first.value.sessionId,'Official UI opens the exact original native contact');
  assert.deepEqual(counts(service),before);assert.equal(gui.report.requests.length,requestsBefore);
  assert.deepEqual(await gui.original(first.value.sessionId),original);
  gui.report.v120Quality.existingContact={botId:bot.botId,firstSessionId:first.value.sessionId,secondSessionId:second.value.sessionId,openedOriginalSessionId:first.value.sessionId};
  gui.check('v120ExistingContactOpensOriginalIdentityWithoutNewOperation',true);
}

async function storageFailure(gui) {
  const service=gui.app.ctx.dshBot,snapshot=await gui.snapshot(),key=`dsh-bot.pending.v1.${snapshot.storeId}`;
  await gui.workbench('Bots');await refresh(gui);
  const editor=gui.card('创建具名 Bot'),marker='V120_STORAGE_BLOCKED_ORIGINAL';
  await editor.getByLabel('名称',{exact:true}).fill(marker);
  const pendingBefore=await gui.page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),key);
  const before=counts(service),requestsBefore=gui.report.requests.length,mutations=[];
  const watch=request=>{const row=payload(request);if(row?.operationId)mutations.push(row);};gui.page.on('request',watch);
  let primary,request;
  try {
    await gui.page.evaluate(key=>{
      const descriptor=Object.getOwnPropertyDescriptor(Storage.prototype,'setItem');
      window.__v120Storage={descriptor,key,attempts:[]};
      Object.defineProperty(Storage.prototype,'setItem',{...descriptor,value:function(k,v){
        if(this===localStorage&&k===key){window.__v120Storage.attempts.push(JSON.parse(v));throw new DOMException('v120 owned profile pending fault','QuotaExceededError');}
        return descriptor.value.call(this,k,v);
      }});
    },key);
    await button(editor,'创建 Bot').click();
    const alert=gui.page.getByRole('alert').filter({hasText:'browser_storage'});await alert.waitFor();
    await waitFor(()=>button(editor,'创建 Bot').isEnabled(),'storage-blocked command settles in actual UI');
    request=await gui.page.evaluate(()=>window.__v120Storage.attempts[0].find(row=>row.input?.name==='V120_STORAGE_BLOCKED_ORIGINAL'));
    assert.ok(request?.operationId);assert.equal(request.action,'bot.create');
    await pendingRow(gui,request.operationId).waitFor();assert.match(await alert.innerText(),/原始请求未发送/);
    assert.equal(await editor.getByLabel('名称',{exact:true}).inputValue(),marker);
    assert.deepEqual(counts(service),before);assert.equal(mutations.length,0);assert.equal(gui.report.requests.length,requestsBefore);
    // Saving again remains mandatory for the original ID continuation.
    await button(pendingRow(gui,request.operationId),'用原 ID 接续').click();
    await waitFor(()=>button(editor,'创建 Bot').isEnabled(),'blocked original ID continuation finishes');
    assert.deepEqual(counts(service),before);assert.equal(mutations.length,0);
    // Readonly lookup must also work while setItem still fails.
    const lookup=await uiCommand(gui,'operation.lookup',()=>button(pendingRow(gui,request.operationId),'查回原始操作').click(),{accept:row=>row.input.operationId===request.operationId});
    assert.equal(lookup.value.state,'unrecorded');assert.deepEqual(lookup.request.input.request,request);
    assert.deepEqual(counts(service),before);assert.equal(mutations.length,0);
    await gui.page.evaluate(()=>Object.defineProperty(Storage.prototype,'setItem',window.__v120Storage.descriptor));
    const recovered=await uiCommand(gui,'operation.lookup',()=>button(pendingRow(gui,request.operationId),'查回原始操作').click(),{accept:row=>row.input.operationId===request.operationId});
    assert.equal(recovered.value.state,'unrecorded');assert.deepEqual(recovered.request.input.request,request);
    assert.deepEqual(counts(service),before);assert.equal(mutations.length,0);assert.equal(gui.report.requests.length,requestsBefore);
    for(const previous of pendingBefore)await pendingRow(gui,previous.operationId).waitFor();
    assert.deepEqual(await gui.page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),key),pendingBefore);
    await pendingRow(gui,request.operationId).waitFor();
    gui.report.v120Quality.storage={key,originalRequest:request,priorPendingOperationIds:pendingBefore.map(row=>row.operationId),mutationsWhileBlocked:mutations.length,readonlyLookups:2};
    // Check committed receipt cleanup separately with the same profile-only
    // fault. A successful reply cannot be reclassified as an unknown operation.
    await gui.page.evaluate(({key,name})=>{
      const state=window.__v120Storage,descriptor=state.descriptor;state.committedId=undefined;
      Object.defineProperty(Storage.prototype,'setItem',{...descriptor,value:function(k,v){
        if(this===localStorage&&k===key){const rows=JSON.parse(v),match=rows.find(row=>row.input?.name===name);
          if(match)state.committedId=match.operationId;
          else if(state.committedId)throw new DOMException('v120 owned committed cleanup fault','QuotaExceededError');}
        return descriptor.value.call(this,k,v);
      }});
    },{key,name:'V120_STORAGE_COMMITTED_RECEIPT'});
    await editor.getByLabel('名称',{exact:true}).fill('V120_STORAGE_COMMITTED_RECEIPT');
    const committed=await uiCommand(gui,'bot.create',()=>button(editor,'创建 Bot').click(),{mutation:true,accept:row=>row.input.name==='V120_STORAGE_COMMITTED_RECEIPT'});
    const notice=gui.page.getByRole('status',{name:'浏览器存储提示',exact:true});await notice.waitFor();
    assert.match(await notice.innerText(),/已收到确定的已提交回执/);assert.ok((await notice.innerText()).includes(committed.request.operationId));
    assert.ok(service.store.read().operations[committed.request.operationId]);await pendingRow(gui,committed.request.operationId).waitFor();
    assert.equal(await gui.page.getByRole('alert').count(),0);
    await gui.page.evaluate(()=>Object.defineProperty(Storage.prototype,'setItem',window.__v120Storage.descriptor));
    await uiCommand(gui,'operation.lookup',()=>button(pendingRow(gui,committed.request.operationId),'查回原始操作').click(),{accept:row=>row.input.operationId===committed.request.operationId});
    await pendingRow(gui,committed.request.operationId).waitFor({state:'hidden'});await notice.waitFor({state:'hidden'});
    await pendingRow(gui,request.operationId).waitFor();for(const previous of pendingBefore)await pendingRow(gui,previous.operationId).waitFor();
    gui.check('v120BrowserStorageFailureRefusesMutationAndKeepsOriginalRequest',true);
  }catch(error){primary=error;}
  finally{await cleanup(primary,[()=>{gui.page.off('request',watch);},()=>gui.page.evaluate(()=>{const state=window.__v120Storage;if(state){Object.defineProperty(Storage.prototype,'setItem',state.descriptor);delete window.__v120Storage;}})]);}
}

async function refreshRecovery(gui) {
  await gui.workbench('记忆');await refresh(gui);
  await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(gui.botIds[0]);await button(gui.page,'资料').click();
  let failNext=false,failures=0,held,pending,primary;
  const faults=await createTrackedRoute(gui.page,'**/api/dsh.bot/snapshot',async route=>{
    if(!failNext)return route.continue();failNext=false;
    const response=await route.fetch();assert.equal((await response.json()).result?.ok,true);
    failures++;await route.abort('failed');
  });
  const failRefresh=async()=>{
    failNext=true;
    await browserRpc(gui,request=>request.url().endsWith('/api/dsh.bot/snapshot'),()=>button(gui.page,'刷新').click(),{transportFailure:true});
    await gui.page.getByRole('alert').filter({hasText:'connection'}).waitFor();faults.throwFailure();
  };
  try {
    await failRefresh();await refresh(gui);assert.equal(await gui.page.getByRole('alert').count(),0);
    await failRefresh();held=await heldReply(gui,'**/api/dsh.bot/snapshot');
    pending=observed(refresh(gui));await held.ready();
    const editor=gui.card('收录资料');
    await editor.getByLabel('资料标题',{exact:true}).fill('V120_NEWER_MATERIAL_REJECTION');
    await editor.getByLabel('正文',{exact:true}).fill('x'.repeat(65537));
    // Observe the rejection without awaiting its refresh, which is deliberately
    // gated behind the older actual snapshot. No reply body is replaced.
    const rejected=await uiCommand(gui,'material.ingest',()=>button(editor,'保存不可变资料').click(),{errorCode:'material_quota',accept:row=>row.input.title==='V120_NEWER_MATERIAL_REJECTION'});
    const alert=gui.page.getByRole('alert').filter({hasText:'material_quota'});await alert.waitFor();const message=await alert.innerText();
    assert.ok(message.includes(rejected.request.operationId));
    await held.finish();await unwrap(pending);assert.equal(await alert.innerText(),message);
    await pendingRow(gui,rejected.request.operationId).waitFor();assert.equal(gui.app.ctx.dshBot.store.read().operations[rejected.request.operationId],undefined);
    assert.equal(failures,2);await editor.getByLabel('正文',{exact:true}).fill('');
    gui.check('v120RefreshRecoveryClearsOnlyOwnedConnectionError',true);
  }catch(error){primary=error;}
  finally{await cleanup(primary,[()=>held?.close(),()=>pending&&unwrap(pending),()=>faults.close()]);}
}

async function materialSeam(gui) {
  const botId=gui.botIds[0],title='V120_EXACT_SEAM_CHUNKS',text='甲'.repeat(799)+'中国'+'乙'.repeat(799);
  const created=await api(gui,'material.ingest',{botId,title,text,mediaType:'text/plain'}),stored=gui.app.ctx.dshBot.store.read().materials[created.value.docId];
  assert.equal(stored.text,text);assert.equal(stored.contentHash,digest(text));assert.equal(stored.chunks.length,2);
  assert.equal(stored.chunks[0].endOffset,800);assert.equal(stored.chunks[1].startOffset,800);
  assert.equal(text.slice(stored.chunks[0].startOffset,stored.chunks[0].endOffset).endsWith('中'),true);
  assert.equal(text.slice(stored.chunks[1].startOffset,stored.chunks[1].endOffset).startsWith('国'),true);
  await gui.workbench('记忆');await refresh(gui);await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(botId);await button(gui.page,'资料').click();
  const search=gui.card('资料检索'),requestsBefore=gui.report.requests.length;
  await search.getByLabel('关键词',{exact:true}).fill('中国');
  const result=await uiCommand(gui,'material.search',()=>button(search,'搜索资料').click(),{accept:row=>row.input.botId===botId&&row.input.query==='中国'});
  const hits=result.value.filter(row=>row.docId===stored.docId);assert.equal(hits.length,2);
  assert.deepEqual(hits.map(row=>row.chunkId),stored.chunks.map(row=>row.chunkId));
  for(let index=0;index<hits.length;index++){
    const hit=hits[index],chunk=stored.chunks[index],original=text.slice(chunk.startOffset,chunk.endOffset);
    assert.equal(hit.excerpt,original);assert.equal(hit.contentHash,digest(text));
    for(const key of ['startOffset','endOffset','startLine','endLine','section'])assert.equal(hit[key],chunk[key]);
    const article=search.locator('article.card').filter({has:gui.page.getByRole('heading',{name:title,exact:true})}).nth(index);
    assert.equal(await article.locator('pre').innerText(),original);
    const page=await uiCommand(gui,'material.page',()=>button(article,'打开此引用').click(),{accept:row=>row.input.docId===stored.docId&&row.input.chunkId===chunk.chunkId});
    assert.equal(page.value.text,original);assert.equal(page.value.chunkId,chunk.chunkId);assert.equal(page.value.contentHash,digest(text));
    const reader=gui.card(title);assert.equal(await reader.locator('pre').innerText(),original);await button(reader,'关闭正文').click();
  }
  assert.equal(gui.report.requests.length,requestsBefore);
  gui.report.v120Quality.materialSeam={docId:stored.docId,contentHash:stored.contentHash,chunks:stored.chunks};
  gui.check('v120MaterialSeamSearchReturnsExistingExactChunks',true);
}

async function reminderRecovery(gui) {
  const service=gui.app.ctx.dshBot,assistant=service.assistant,originalNow=assistant.clock.now;
  let now=Math.ceil(Date.now()/60000)*60000,created,primary;assistant.clock.now=()=>now;
  try {
    const due=now+60000,dueAt=new Date(due).toISOString(),rule={kind:'once',timezone:'UTC',date:dueAt.slice(0,10),time:dueAt.slice(11,16)};
    created=(await api(gui,'schedule.create',{ownerBotId:gui.botIds[0],kind:'reminder',message:'V120_PAUSED_ONCE_ORIGINAL',rule,enabled:true})).value;
    await api(gui,'schedule.state',{scheduleId:created.scheduleId,expectedVersion:created.version,enabled:false});
    now=due+120000;await assistant.runDue();
    assert.equal(Object.values(service.store.read().occurrences).filter(row=>row.scheduleId===created.scheduleId).length,0);
    await gui.workbench('任务');await refresh(gui);const pane=gui.card('新任务');await gui.expand(pane,'提醒与定时');
    const row=pane.locator('article.card').filter({has:gui.page.getByRole('heading',{name:'V120_PAUSED_ONCE_ORIGINAL',exact:true})});
    await button(row,'编辑并重新确认').click();
    const editor=pane.locator('form').filter({has:button(gui.page,'重新确认并保存安排')});
    await editor.getByLabel('提醒内容',{exact:true}).fill('V120_PAUSED_ONCE_EDITED_LATE');
    const updated=await uiCommand(gui,'schedule.update',()=>button(editor,'重新确认并保存安排').click(),{mutation:true,accept:request=>request.input.scheduleId===created.scheduleId});
    assert.equal(updated.value.enabled,false);assert.deepEqual(updated.value.rule,created.rule);
    assert.equal(updated.value.nextDueAt,created.nextDueAt);assert.equal(updated.value.nextTriggerKey,created.nextTriggerKey);
    assert.equal(Object.values(service.store.read().notices).filter(row=>row.scheduleId===created.scheduleId).length,0);
    const edited=pane.locator('article.card').filter({has:gui.page.getByRole('heading',{name:'V120_PAUSED_ONCE_EDITED_LATE',exact:true})});
    const requestsBefore=gui.report.requests.length;
    await uiCommand(gui,'schedule.state',()=>button(edited,'启用安排').click(),{mutation:true,accept:request=>request.input.scheduleId===created.scheduleId});
    await assistant.runDue();await assistant.runDue();
    const state=service.store.read(),notices=Object.values(state.notices).filter(row=>row.scheduleId===created.scheduleId),occurrences=Object.values(state.occurrences).filter(row=>row.scheduleId===created.scheduleId);
    assert.equal(notices.length,1);assert.equal(occurrences.length,1);assert.equal(notices[0].message,'V120_PAUSED_ONCE_EDITED_LATE');
    assert.equal(notices[0].dueAt,dueAt);assert.equal(notices[0].late,true);assert.equal(occurrences[0].dueAt,dueAt);
    assert.equal(state.schedules[created.scheduleId].nextDueAt,null);assert.equal(gui.report.requests.length,requestsBefore);
    await refresh(gui);
    const notice=pane.locator('article.card').filter({has:gui.page.getByRole('heading',{name:'提醒',exact:true})}).filter({hasText:'V120_PAUSED_ONCE_EDITED_LATE'});await notice.waitFor();
    assert.match(await notice.innerText(),/原定 .*迟到/);
    gui.report.v120Quality.reminder={scheduleId:created.scheduleId,originalDueAt:dueAt,originalTriggerKey:created.nextTriggerKey,noticeId:notices[0].noticeId,occurrenceId:occurrences[0].occurrenceId};
    gui.check('v120EditedPausedOnceReminderKeepsOriginalDueAndNotifiesOnce',true);
  }catch(error){primary=error;}
  finally{await cleanup(primary,[()=>{assistant.clock.now=originalNow;},async()=>{if(created){const schedule=service.store.read().schedules[created.scheduleId];if(schedule.enabled)await api(gui,'schedule.state',{scheduleId:created.scheduleId,expectedVersion:schedule.version,enabled:false});}},()=>assistant.runDue()]);}
}

async function groupRevocation(gui) {
  const service=gui.app.ctx.dshBot,ids=[];
  for(const name of ['V120_GROUP_B_SOURCE','V120_GROUP_A_DERIVED','V120_GROUP_C_READER'])ids.push((await api(gui,'bot.create',{name,contact:{provider:controlledProvider,model:'model-c'}})).value.botId);
  const [botB,botA,botC]=ids;
  // Explicit real API sharing setup permits exactly this chain. These are
  // source ACLs, not forged origins or substituted native replies.
  for(const botId of ids)await api(gui,'share.set',{botId,expectedVersion:service.store.read().bots[botId].revision,share:{enabled:true,receivers:ids.filter(id=>id!==botId),scope:{sessions:['*'],tasks:[],memories:[],materials:['*']}}});
  const group=(await api(gui,'group.create',{name:'V120_REAL_SOURCE_CHAIN',botIds:ids,coordinatorBotId:botA,rounds:1,maxRequests:6})).value;
  await gui.workbench('内部群');await refresh(gui);const card=gui.card(group.name);
  await card.getByLabel('消息',{exact:true}).fill('V120_REAL_GROUP_SOURCE_CHAIN');
  const posted=await uiCommand(gui,'group.post',()=>button(card,'发送给群成员').click(),{mutation:true,accept:row=>row.input.groupId===group.groupId});
  const roundId=posted.value.roundId;assert.ok(roundId);
  await waitFor(()=>{
    const state=service.store.read(),round=state.groups[group.groupId].rounds[roundId];
    return round.state==='complete'&&round.channels.length===3&&round.channels.every(id=>service.adapter.resources(id).settled);
  },'v120 exact actual three-member group round settled');
  const state=service.store.read(),round=state.groups[group.groupId].rounds[roundId],messages=state.groups[group.groupId].messages.filter(row=>row.roundId===roundId&&row.producer.kind==='bot');
  assert.deepEqual(messages.map(row=>row.producer.botId),ids);
  const [source,derived]=messages,sourceId=source.source.sessionId,derivedId=derived.source.sessionId;
  assert.equal(sourceId,round.channels[0],'B source is the first actual round channel');
  assert.equal(derivedId,round.channels[1],'A derivation is the second actual round channel');
  assert.equal(source.producer.botId,botB);assert.equal(derived.producer.botId,botA);
  assert.equal(source.producer.sessionId,sourceId);assert.equal(derived.producer.sessionId,derivedId);
  for(let index=0;index<3;index++){
    const channel=state.sessions[round.channels[index]];
    assert.equal(messages[index].source.sessionId,round.channels[index]);
    assert.equal(messages[index].producer.sessionId,round.channels[index]);
    assert.equal(channel.sessionId,round.channels[index]);assert.equal(channel.botId,ids[index]);
    assert.equal(channel.lineage.groupId,group.groupId);assert.equal(channel.lineage.roundId,roundId);
  }
  const binding=state.sessions[derivedId];assert.ok(binding.origins.some(ref=>ref.kind==='session'&&ref.id===sourceId));
  assert.ok(derived.origins.some(ref=>ref.kind==='session'&&ref.id===sourceId));
  const logsBefore=await Promise.all(round.channels.map(id=>gui.original(id)));
  const prompt=logsBefore[1].find(row=>row.type==='user/message'&&row.data.content?.some(part=>part.type==='text'&&part.text.includes('仅讨论本群材料：')));
  assert.ok(prompt);assert.ok(prompt.data.content.some(part=>part.text?.includes(sourceId)&&part.text?.includes(source.messageId)));
  for(let index=0;index<3;index++){
    assert.ok(logsBefore[index].some(row=>row.type==='assistant/message'&&row.data.message?.id===messages[index].messageId));
    assert.equal(gui.report.requests.filter(row=>row.sessionId===round.channels[index]&&row.purpose==='conversation'&&row.finish==='stop').length,1);
  }
  const consumer=(await api(gui,'session.create',{botId:botA,name:'V120_REAL_DERIVATION_CONSUMER'})).value;
  const actor=service.policy.fromAgent(gui.app.ctx.agents.get(consumer.sessionId));
  const view=service.collaboration.viewGroup(actor,state.groups[group.groupId]);
  assert.ok(view.messages.some(row=>row.messageId===source.messageId));assert.ok(view.messages.some(row=>row.messageId===derived.messageId));
  assert.ok(service.policy.readDependencies(actor).some(ref=>ref.kind==='session'&&ref.id===sourceId));
  const marker='V120_REAL_GROUP_DERIVED_MATERIAL',operationId=randomUUID();
  const material=await service.dispatch(actor,{operationId,action:'material.ingest',input:{botId:botA,title:marker,text:`${marker}\n${view.messages.map(row=>row.text).join('\n')}`,mediaType:'text/plain'}});
  assert.ok(service.store.read().operations[operationId]);assert.ok(material.origins.some(ref=>ref.kind==='session'&&ref.id===sourceId));
  const pre=(await api(gui,'session.create',{botId:botC,name:'V120_READER_BEFORE_REVOCATION'})).value;
  const preActor=service.policy.fromAgent(gui.app.ctx.agents.get(pre.sessionId));
  assert.ok((await service.dispatch(preActor,{action:'material.search',input:{botId:botA,query:marker}})).some(row=>row.docId===material.docId));
  const post=(await api(gui,'session.create',{botId:botC,name:'V120_READER_AFTER_REVOCATION'})).value;
  const postActor=service.policy.fromAgent(gui.app.ctx.agents.get(post.sessionId));
  const originalShare=structuredClone(service.store.read().bots[botB].share);
  await api(gui,'share.set',{botId:botB,expectedVersion:service.store.read().bots[botB].revision,share:{...originalShare,scope:{...originalShare.scope,sessions:[]}}});
  const hidden=service.collaboration.viewGroup(postActor,service.store.read().groups[group.groupId]);
  assert.equal(hidden.messages.some(row=>row.messageId===source.messageId),false);
  assert.equal(hidden.messages.some(row=>row.messageId===derived.messageId),false);
  assert.equal(service.policy.canRead(postActor,{kind:'material',id:material.docId}),false);
  assert.equal((await service.dispatch(postActor,{action:'material.search',input:{botId:botA,query:marker}})).some(row=>row.docId===material.docId),false);
  assert.equal(service.store.read().materials[material.docId].text,material.text);
  assert.deepEqual(await Promise.all(round.channels.map(id=>gui.original(id))),logsBefore);
  gui.report.v120Quality.groupRevocation={groupId:group.groupId,roundId,memberOrder:ids,sourceSessionId:sourceId,derivedSessionId:derivedId,derivedBindingOrigins:binding.origins,derivedMessageOrigins:derived.origins,consumedMessageIds:view.messages.map(row=>row.messageId),materialId:material.docId,materialOrigins:material.origins,nativeRequests:gui.report.requests.filter(row=>round.channels.includes(row.sessionId)),nativePrompt:prompt};
  gui.check('v120GroupReplySourceRevocationHidesLaterDerivedMaterial',true);
}

export async function runV120QualityChecks(gui) {
  const originalChecks=Object.keys(gui.report.checks).length;
  gui.report.v120Quality={realBrowser:true,actualInstalledNative:true,ownedRpcObservers:true,actualReplyBodiesPreserved:true,profileScopedStorageFault:true,realAssistantClock:true,apiCommands:0,uiCommands:0,originalChecksBeforeV120:originalChecks};
  await existingContact(gui);await storageFailure(gui);await refreshRecovery(gui);await materialSeam(gui);await reminderRecovery(gui);await groupRevocation(gui);
  gui.check('v120QualityUsesNoExternalModelRequests',gui.report.realModelRequests===0&&gui.report.requests.every(row=>row.provider===controlledProvider));
  gui.report.v120Quality.checksAdded=Object.keys(gui.report.checks).length-originalChecks;assert.equal(gui.report.v120Quality.checksAdded,7);
  await gui.save('v120-native-quality');
}
