import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {controlledProvider,waitFor} from './stock-gui-runtime.mjs';
import {createTrackedRoute} from './stock-route-scope.mjs';
import * as OfficialAskUser from '@deepseek-ai/dsh-tool-ask-user';

const button=(scope,name)=>scope.getByRole('button',{name,exact:true});
const space=gui=>gui.page.locator('.dsh-bot-space');
const paint=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const payload=request=>{try{return request.postDataJSON()?.payload;}catch{return undefined;}};

export function isCurrentIndependentApprovalProbe(state,binding,target) {
  const receipt=state.operations?.[target?.operationId],original=receipt?.result;
  if(receipt?.action!=='meeting.start'||original?.groupId!==target?.groupId||original?.phase!=='independent'||
    binding?.purpose!=='independent'||!['creating','ready'].includes(binding.state))return false;
  const lineage=binding.lineage,meeting=state.meetings?.[original.meetingId],group=state.groups?.[original.groupId];
  if(!lineage||lineage.meetingId!==original.meetingId||lineage.groupId!==original.groupId||lineage.phase!=='independent'||
    lineage.sessionId!==binding.sessionId||lineage.botId!==binding.botId||meeting?.phase!=='independent'||
    meeting.groupId!==original.groupId||meeting.epoch!==original.epoch||lineage.epoch!==original.epoch)return false;
  const old=original.participants?.find(row=>row.sessionId===binding.sessionId&&row.botId===binding.botId&&row.active),
    current=meeting.participants?.find(row=>row.sessionId===binding.sessionId&&row.botId===binding.botId&&row.active),
    member=group?.members?.find(row=>row.botId===binding.botId&&row.active);
  return !!old&&!!current&&!!member&&old.memberEpoch===current.memberEpoch&&current.memberEpoch===lineage.memberEpoch&&member.epoch===lineage.memberEpoch;
}

export function originalTimedQuestionReplies(events,callId) {
  return events.filter(row=>row.type==='user/message'&&row.data.source?.kind==='user-question-reply'&&row.data.source.callId===callId);
}

export function assertNativeQuestionHistoryExcluded(body,events,requested) {
  for(const event of events) {
    const message=event.type==='user/message'?event.data:event.type==='assistant/message'?event.data.message:undefined;
    for(const part of message?.content??[])if(part.type==='text'&&part.text&&!requested.some(text=>text.includes(part.text)))
      assert.equal(body.includes(part.text),false,'Exact-channel question must not expose unrequested channel history');
  }
}

export function observeOriginalMainReadiness() {
  const services=window.__stockV130ClientServices,roster=services.sessions.list.getSnapshot(),workspace=services.workspaces?.list.getSnapshot();
  const mains=Object.values(roster.byId).filter(row=>(row.retainedBy.mainView??0)>0),mainIds=mains.map(row=>row.id).sort();
  const opened=mains.map(row=>{const snapshot=services.sessions.binding(row.id)?.session.getSnapshot();return snapshot?.openState==='open'&&snapshot.removed===false;});
  return {ready:roster.phase==='ready'&&workspace?.phase==='ready'&&mains.length===1&&mains[0].retainedBy.mainView===1&&opened[0]===true,mainIds};
}

// Observe the installed plugin's actual context. The original module factory
// and apply each execute once and return their original object/result. This
// fixture never replaces a service, renderer, request, or component.
export function observeInstalledClientContext() {
  let facade;
  const factories=new WeakMap(),plugins=new WeakSet();
  const observed=record=>{
    if(!['dsh-bot','dsh-bot/client'].includes(record.id))return record;
    const factory=record.factory;
    let wrapper=factories.get(factory);
    if(!wrapper){wrapper=function(...args){
      const exports=Reflect.apply(factory,this,args),plugin=typeof exports?.apply==='function'?exports:exports?.['./client'];
      if(plugin&&!plugins.has(plugin)){plugins.add(plugin);const apply=plugin.apply;
        plugin.apply=function(...parameters){window.__stockV130ClientCtx=parameters[0];window.__stockV130ClientServices={sessions:parameters[0].sessions,layout:parameters[0].layout,uiSession:parameters[0].uiSession,connection:parameters[0].connection,get workspaces(){return parameters[0].get('workspaces');}};return Reflect.apply(apply,this,parameters);};}
      return exports;
    };factories.set(factory,wrapper);factories.set(wrapper,wrapper);}
    return {...record,factory:wrapper};
  };
  Object.defineProperty(window,'__ModuleLoader__',{configurable:true,get:()=>facade,set(value){
    facade=value;
    let load;
    const setLoad=original=>{load=function(record){return Reflect.apply(original,this,[observed(record)]);};};
    setLoad(value.load);
    // SDK create() changes this same facade from queue to live registration.
    // Observe either load function without changing its registration semantics.
    Object.defineProperty(value,'load',{configurable:true,enumerable:true,get:()=>load,set:setLoad});
  }});
}
async function clientFacts(gui,ids=[]) {
  return gui.page.evaluate(ids=>{
    const ctx=window.__stockV130ClientServices;
    if(!ctx)throw Error('Actual installed plugin context was not observed');
    const roster=ctx.sessions.list.getSnapshot();
    return {panel:ctx.layout.panelInfo.getSnapshot().activePanelId,generation:ctx.connection?.generation.getSnapshot()?.id??null,
      mainIds:Object.values(roster.byId).filter(row=>(row.retainedBy.mainView??0)>0).map(row=>row.id).sort(),
      references:Object.fromEntries(ids.map(id=>[id,ctx.sessions.retainInfo(id).getSnapshot().retainedBy.botSpace??0])),
      pending:Object.fromEntries(ids.map(id=>[id,ctx.uiSession.sessionStatus.getSnapshot().get(id)?.pendingInteraction?.kind??null]))};
  },ids);
}
async function command(gui,action,interact) {
  let timer,selected,dispose;
  const result=new Promise((resolve,reject)=>{
    const finish=(done,value)=>{clearTimeout(timer);gui.page.off('request',onRequest);gui.page.off('response',onResponse);gui.page.off('requestfailed',onFailed);gui.page.off('close',onClose);done(value);};
    const onRequest=request=>{if(!selected&&payload(request)?.action===action)selected=request;};
    const onResponse=async response=>{if(response.request()!==selected)return;try{const reply=(await response.json()).result;assert.equal(reply?.ok,true,`${action}: ${reply?.error?.code}`);finish(resolve,{request:payload(selected),value:reply.value});}catch(error){finish(reject,error);}};
    const onFailed=request=>{if(request===selected)finish(reject,Error('Actual space command failed transport'));};
    const onClose=()=>finish(reject,Error('Actual space page closed during command'));
    dispose=()=>finish(reject,Error('Space command observer completed'));
    gui.page.on('request',onRequest);gui.page.on('response',onResponse);gui.page.on('requestfailed',onFailed);gui.page.on('close',onClose);
    timer=setTimeout(()=>finish(reject,Error(`Actual space command timed out: ${action}`)),30000);
  });
  // Observe rejection immediately even if interaction fails before a request.
  const outcome=result.then(value=>({value}),error=>({error}));
  try {
    const [,row]=await Promise.all([Promise.resolve().then(interact),outcome]);
    if(row.error)throw row.error;
    const saved=gui.app.ctx.dshBot.store.read().operations[row.value.request.operationId];
    assert.ok(saved,'The actual GUI command retains its original durable operation');
    gui.report.v130Space.uiCommands++;
    await paint(gui.page);return row.value;
  } finally {dispose();await outcome;}
}
async function openSpace(gui) {await gui.page.locator('button[aria-label="Bot 空间"][class*="_panelRow"]').click();await space(gui).waitFor();}
async function selectBot(gui,botId) {await space(gui).locator(`.bs-contact[data-bot-id="${botId}"]`).click();await paint(gui.page);}
async function selectGroup(gui,groupId) {await space(gui).locator(`.bs-contact[data-group-id="${groupId}"]`).click();await space(gui).getByLabel('群消息',{exact:true}).waitFor();}
async function selectContact(gui,botId,sessionId) {await selectBot(gui,botId);await space(gui).locator(`.bs-history-item[data-session-id="${sessionId}"]`).click();return native(gui,sessionId);}
async function native(gui,sessionId) {const scope=space(gui).locator(`.bs-native[data-session-id="${sessionId}"]`);await scope.waitFor();await scope.locator('[data-composer-input="true"][contenteditable="true"]').waitFor();return scope;}
async function chat(gui,sessionId,text) {const before=gui.report.requests.filter(row=>row.sessionId===sessionId&&row.purpose==='conversation').length;const input=(await native(gui,sessionId)).locator('[data-composer-input="true"][contenteditable="true"]');await input.fill(text);await input.press('Enter');await waitFor(()=>{const rows=gui.report.requests.filter(row=>row.sessionId===sessionId&&row.purpose==='conversation');return rows.length>before&&rows.at(-1).finish==='stop';},'actual embedded native reply');await gui.app.ctx.agents.get(sessionId).whenIdle();await gui.app.ctx.sessions.flush(gui.app.ctx.agents.get(sessionId).session);}
async function createBot(gui,name,model) {
  await button(space(gui),'新建 Bot').click();const dialog=gui.page.getByRole('dialog',{name:'新建 Bot',exact:true});
  await dialog.getByLabel('名称',{exact:true}).fill(name);await dialog.getByLabel('职责',{exact:true}).fill('受控官方安装验收');
  if(model)await dialog.getByLabel('模型',{exact:true}).selectOption(JSON.stringify({provider:controlledProvider,model}));
  const row=await command(gui,'bot.create',()=>button(dialog,'提交创建 Bot').click());await dialog.waitFor({state:'hidden'});return row.value;
}
async function newContact(gui,botId) {await selectBot(gui,botId);const row=await command(gui,'session.create',()=>button(space(gui),'开始新对话').click());await native(gui,row.value.sessionId);return row;}
async function createGroup(gui,name,ids) {
  await button(space(gui),'新建群').click();const dialog=gui.page.getByRole('dialog',{name:'新建群',exact:true});
  await dialog.getByLabel('名称',{exact:true}).fill(name);for(const id of ids)await dialog.getByLabel(`选择成员 ${id}`,{exact:true}).check();await dialog.getByLabel('协调者',{exact:true}).selectOption(ids[0]);
  const row=await command(gui,'group.create',()=>button(dialog,'提交创建群').click());await dialog.waitFor({state:'hidden'});return row.value;
}
async function groupPost(gui,groupId,text) {await selectGroup(gui,groupId);await space(gui).getByLabel('群消息',{exact:true}).fill(text);return command(gui,'group.post',()=>button(space(gui),'发送消息').click());}
async function screenshot(gui,name) {await paint(gui.page);await gui.page.screenshot({path:join(gui.evidence,`${name}.png`),fullPage:true});gui.report.v130Space.screenshots.push(`${name}.png`);}

async function groupDrafts(gui,first,second) {
  await selectGroup(gui,first);const input=space(gui).getByLabel('群消息',{exact:true});
  const text='中文输入法合成草稿';await input.fill(text);const before=Object.keys(gui.app.ctx.dshBot.store.read().operations).length;
  await input.dispatchEvent('compositionstart');await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true});await input.dispatchEvent('compositionend');await paint(gui.page);
  assert.equal(Object.keys(gui.app.ctx.dshBot.store.read().operations).length,before);assert.equal(await input.inputValue(),text);
  let original;const failed=await createTrackedRoute(gui.page,'**/api/dsh.bot/command',async route=>{
    const row=payload(route.request());if(row?.action!=='group.post'||row.input.groupId!==first){await route.continue();return;}original=row;await route.abort('failed');
  });
  try {await button(space(gui),'发送消息').click();await waitFor(()=>original!==undefined,'actual failed original group submission');await waitFor(()=>button(space(gui),'发送消息').isEnabled(),'failed group submit restores input');assert.equal(await input.inputValue(),text);
    const retained=await gui.page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('dsh-bot.pending.v1.')).flatMap(key=>JSON.parse(localStorage.getItem(key))));
    assert.ok(retained.some(row=>row.operationId===original.operationId&&row.action==='group.post'&&row.input.groupId===first&&row.input.text===text));
    assert.equal(gui.app.ctx.dshBot.store.read().operations[original.operationId],undefined);
    gui.check('v130GroupDraftPreservesImeAndFailedOriginalSubmission',true);
  } finally {await failed.close();}
  const release=deferred();let pending;const held=await createTrackedRoute(gui.page,'**/api/dsh.bot/command',async route=>{
    const row=payload(route.request());if(row?.action!=='group.post'||row.input.groupId!==first){await route.continue();return;}
    pending=row;const response=await route.fetch();await release.promise;await route.fulfill({response});
  });
  try {
    await input.fill('原群提交中的正文');await button(space(gui),'发送消息').click();await waitFor(()=>pending!==undefined&&gui.app.ctx.dshBot.store.read().operations[pending.operationId]!==undefined,'original group request durably accepted before held response');
    await selectGroup(gui,second);await space(gui).getByLabel('群消息',{exact:true}).fill('另一群保留正文');
    release.resolve();await waitFor(()=>gui.app.ctx.dshBot.store.read().operations[pending.operationId]!==undefined,'original held group receipt');await held.drain();await waitFor(()=>button(space(gui),'发送消息').isEnabled(),'held original submission restores controls in current group');await paint(gui.page);
    assert.equal(await space(gui).getByLabel('群消息',{exact:true}).inputValue(),'另一群保留正文');
    await selectGroup(gui,first);assert.equal(await space(gui).getByLabel('群消息',{exact:true}).inputValue(),'');
    assert.equal(Object.keys(gui.app.ctx.dshBot.store.read().operations).filter(id=>id===pending.operationId).length,1);
  } finally {release.resolve();await held.close();}
  const releaseEdited=deferred();let editedRequest;
  const heldEdited=await createTrackedRoute(gui.page,'**/api/dsh.bot/command',async route=>{
    const row=payload(route.request());if(row?.action!=='group.post'||row.input.groupId!==first){await route.continue();return;}
    editedRequest=row;const response=await route.fetch();await releaseEdited.promise;await route.fulfill({response});
  });
  try {
    await input.fill('提交后继续编辑的原文');await button(space(gui),'发送消息').click();
    await waitFor(()=>editedRequest!==undefined&&gui.app.ctx.dshBot.store.read().operations[editedRequest.operationId]!==undefined,'original accepted group post before later draft edit');
    await input.fill('同一群后来编辑的正文');releaseEdited.resolve();await heldEdited.drain();
    await waitFor(()=>button(space(gui),'发送消息').isEnabled(),'edited original group receipt settles');
    assert.equal(await input.inputValue(),'同一群后来编辑的正文');
    assert.equal(gui.app.ctx.dshBot.store.read().operations[editedRequest.operationId].action,'group.post');
    gui.check('v130GroupPendingSubmitClearsOnlyOriginalUneditedDraft',true);
  } finally {releaseEdited.resolve();await heldEdited.close();}
}

export async function runV130BotSpaceChecks(gui) {
  const initialRequests=gui.report.requests.length;
  gui.v130ChecksStarted=true;
  gui.report.v130Space={uiCommands:0,screenshots:[],nativeReferenceWitness:false,approvalWitness:false,groupApprovalWitness:false,independentApprovalWitness:false,groupQuestionWitness:false,discussionPlanReviewWitness:false,cancelledOpinionsSealed:false,mainSelectionPreserved:false};
  await gui.page.setViewportSize({width:1600,height:1000});
  await gui.page.addInitScript(observeInstalledClientContext);await gui.page.reload({waitUntil:'networkidle'});
  await waitFor(()=>gui.page.evaluate(()=>!!window.__stockV130ClientCtx),'actual installed client apply observation');
  await waitFor(async()=>(await gui.page.evaluate(observeOriginalMainReadiness)).ready,'original stock main selection restores ready catalog, reference and binding');
  const main=(await clientFacts(gui)).mainIds;
  assert.deepEqual(main,(await gui.page.evaluate(observeOriginalMainReadiness)).mainIds);
  const service=()=>gui.app.ctx.dshBot,operationsBefore=Object.keys(service().store.read().operations).length,requestsBefore=gui.report.requests.length;
  await openSpace(gui);assert.deepEqual((await clientFacts(gui)).mainIds,main);assert.equal((await clientFacts(gui)).panel,'dsh-bot.space');
  assert.equal(gui.report.requests.length,requestsBefore);assert.equal(Object.keys(service().store.read().operations).length,operationsBefore);
  gui.check('v130DedicatedSpaceOpensWithoutModelRequestOrMainNavigation',true);
  const originalId=gui.contactId,originalBinding=service().store.read().sessions[originalId];assert.ok(originalBinding&&originalBinding.state==='ready');
  const originalNative=await selectContact(gui,originalBinding.botId,originalId);
  const originalEvents=await gui.original(originalId),historyText=originalEvents.filter(row=>row.type==='assistant/message').flatMap(row=>row.data.message?.content??[]).filter(row=>row.type==='text').map(row=>row.text);
  assert.ok(historyText.length>0,'Actual predecessor native history exists');await originalNative.getByText(historyText.at(-1),{exact:false}).first().waitFor();
  assert.equal((await clientFacts(gui,[originalId])).references[originalId],1);assert.deepEqual((await clientFacts(gui)).mainIds,main);
  gui.report.v130Space.nativeReferenceWitness=true;gui.check('v130ExistingPrivateHistoryUsesOriginalSessionAndOwnedReference',true);
  await screenshot(gui,'v130-space-private-light');await theme(gui,'dark');await screenshot(gui,'v130-space-private-dark');await theme(gui,'light');
  const first=await createBot(gui,'空间同名 Bot','model-a'),second=await createBot(gui,'空间同名 Bot','model-b');assert.notEqual(first.botId,second.botId);
  const firstContact=await newContact(gui,first.botId),secondContact=await newContact(gui,second.botId);
  await chat(gui,secondContact.value.sessionId,'V130_BOT_B_ONLY');await selectContact(gui,first.botId,firstContact.value.sessionId);
  const inputA=space(gui).locator('[data-composer-input="true"][contenteditable="true"]');await inputA.fill('甲的原生私聊草稿');
  const inputB=(await selectContact(gui,second.botId,secondContact.value.sessionId)).locator('[data-composer-input="true"][contenteditable="true"]');assert.equal(await inputB.innerText(),'');await inputB.fill('乙的原生私聊草稿');
  await selectContact(gui,first.botId,firstContact.value.sessionId);assert.equal(await inputA.innerText(),'甲的原生私聊草稿');assert.equal((await clientFacts(gui,[secondContact.value.sessionId])).references[secondContact.value.sessionId],0);
  assert.equal(service().store.read().sessions[firstContact.value.sessionId].botId,first.botId);assert.equal(service().store.read().sessions[secondContact.value.sessionId].botId,second.botId);
  gui.check('v130TwoSameNameBotsKeepSeparateIdentityHistoryAndDrafts',true);
  await inputA.fill('');const next=await newContact(gui,first.botId);assert.notEqual(next.value.sessionId,firstContact.value.sessionId);assert.equal(service().store.read().operations[next.request.operationId].result.sessionId,next.value.sessionId);
  assert.deepEqual((await clientFacts(gui)).mainIds,main);gui.check('v130NewConversationKeepsReceiptSessionWithoutMainNavigation',true);
  await chat(gui,next.value.sessionId,'V130_SELECTED_PRIVATE');assert.equal(gui.report.requests.filter(row=>row.sessionId===next.value.sessionId&&row.purpose==='conversation').at(-1).model,'model-a');
  assert.equal(gui.report.requests.filter(row=>row.sessionId===secondContact.value.sessionId&&row.purpose==='conversation').at(-1).model,'model-b');
  gui.check('v130EmbeddedNativeComposerUsesSelectedBotModel',true);

  const unregister=registerApprovalTool(gui);
  try {
    gui.v130ApprovalSession=next.value.sessionId;await chatApproval(gui,next.value.sessionId);
    gui.report.v130Space.approvalWitness=true;gui.check('v130EmbeddedNativeToolApprovalHasOriginalAuditPair',true);
  } finally {gui.v130ApprovalSession=undefined;unregister();}
  const count=gui.report.requests.length,group=await createGroup(gui,'空间协作群',[first.botId,second.botId]);
  assert.equal(gui.report.requests.length,count);assert.deepEqual(new Set(service().store.read().groups[group.groupId].members.filter(row=>row.active).map(row=>row.botId)),new Set([first.botId,second.botId]));
  gui.check('v130SpaceCreatesTwoMemberGroupWithoutModelRequest',true);
  await groupPost(gui,group.groupId,'V130_TWO_REAL_MEMBERS');await gui.until(snapshot=>snapshot.groups.find(row=>row.groupId===group.groupId)?.messages.filter(row=>row.producer.kind==='bot').length===2,'two genuine member replies');
  const replies=service().store.read().groups[group.groupId].messages.filter(row=>row.producer.kind==='bot');assert.deepEqual(new Set(replies.map(row=>row.producer.botId)),new Set([first.botId,second.botId]));
  for(const row of replies){assert.ok(row.source?.sessionId);assert.ok(gui.report.requests.some(request=>request.sessionId===row.source.sessionId&&request.finish==='stop'));assert.ok((await gui.original(row.source.sessionId)).some(event=>event.type==='assistant/message'));}
  gui.check('v130GroupRepliesComeFromActualIndependentNativeMembers',true);await screenshot(gui,'v130-space-group-light');
  await heldStop(gui,group.groupId);const otherGroup=await createGroup(gui,'空间草稿群',[first.botId,second.botId]);await groupDrafts(gui,group.groupId,otherGroup.groupId);await groupApproval(gui,group.groupId,otherGroup.groupId);
  await groupQuestions(gui,group.groupId,otherGroup.groupId);
  await timedGroupQuestion(gui,group.groupId,otherGroup.groupId);
  await taskAndMeeting(gui,first,second,next.value.sessionId,group.groupId);
  await cancelledIndependentMeeting(gui,group.groupId);
  await managementTargets(gui,second.botId,group.groupId);
  await responsive(gui,group.groupId);await disableChecks(gui,next.value.sessionId,main);
  gui.report.v130Space.mainSelectionPreserved=true;
  assert.ok(gui.report.requests.length>initialRequests);assert.equal(gui.report.realModelRequests,0);assert.ok(gui.report.requests.every(row=>row.provider===controlledProvider));
  gui.check('v130SpaceUsesNoExternalModelRequests',true);
}

async function chatApproval(gui,sessionId) {
  const input=(await native(gui,sessionId)).locator('[data-composer-input="true"][contenteditable="true"]');await input.fill('V130_NATIVE_APPROVAL');await input.press('Enter');
  const approval=space(gui).locator('[data-approval-key]');await approval.waitFor();assert.equal((await clientFacts(gui,[sessionId])).pending[sessionId],'approval');
  const key=await approval.getAttribute('data-approval-key');assert.ok(key);
  await screenshot(gui,'v130-space-native-approval');await button(approval,'允许一次').click();await approval.waitFor({state:'hidden'});await gui.app.ctx.agents.get(sessionId).whenIdle();
  await gui.app.ctx.sessions.flush(gui.app.ctx.agents.get(sessionId).session);const events=await gui.original(sessionId),asked=events.filter(row=>row.type==='approval/asked'&&row.data.toolName==='stock_v130_approval');assert.equal(asked.length,1);
  assert.ok(events.some(row=>row.type==='approval/decided'&&row.data.id===asked[0].data.id&&row.data.outcome==='allowed-once'));
  assert.ok(events.some(row=>row.type==='tool/result'&&JSON.stringify(row.data).includes('allowed-once')));
}
async function heldStop(gui,groupId) {
  gui.v130GroupHoldGroupId=groupId;
  try {
    const posted=await groupPost(gui,groupId,'V130_HELD_GROUP_STOP'),roundId=posted.value.roundId;
    await waitFor(()=>{const round=gui.app.ctx.dshBot.store.read().groups[groupId].rounds[roundId];return round.channels.length===1&&gui.activeSignals.has(round.channels[0]);},'held actual first group member');
    const initial=structuredClone(gui.app.ctx.dshBot.store.read().groups[groupId].rounds[roundId]),firstId=initial.channels[0];
    await command(gui,'group.round.stop',()=>button(space(gui).locator(`.bs-round[data-round-id="${roundId}"]`),'停止此群轮').click());
    await waitFor(()=>gui.app.ctx.dshBot.store.read().groups[groupId].rounds[roundId].state==='stopped','exact held group native resources settle');
    const round=gui.app.ctx.dshBot.store.read().groups[groupId].rounds[roundId];assert.deepEqual(round.channels,initial.channels);assert.equal(initial.requests,1);assert.equal(round.requests,initial.requests);assert.equal(gui.activeSignals.get(firstId).aborted,true);
    assert.ok(gui.app.ctx.dshBot.adapter.resources(firstId).settled);assert.equal(gui.app.ctx.dshBot.store.read().groups[groupId].messages.filter(row=>gui.app.ctx.dshBot.store.read().sessions[row.source?.sessionId]?.lineage?.roundId===roundId&&row.producer.kind==='bot').length,0);
    assert.equal(gui.report.requests.filter(row=>gui.app.ctx.dshBot.store.read().sessions[row.sessionId]?.lineage?.roundId===roundId&&row.purpose==='conversation').length,1);
    gui.check('v130HeldGroupStopSettlesOriginalChannelAndPreventsNextMember',true);await screenshot(gui,'v130-space-group-stopped');
  } finally {gui.v130GroupHoldGroupId=undefined;}
}
async function taskAndMeeting(gui,first,second,sessionId,groupId) {
  await selectContact(gui,first.botId,sessionId);await button(space(gui),'新任务').click();let dialog=gui.page.getByRole('dialog',{name:'新任务',exact:true});
  await dialog.getByLabel('任务标题',{exact:true}).fill('空间私人后台任务');await dialog.getByLabel('目标',{exact:true}).fill('GUI_V130_HOLD 私人任务');await dialog.getByLabel('验收条件（每行一项）',{exact:true}).fill('真实资源结算');
  const created=await command(gui,'task.create',()=>button(dialog,'登记任务').click());await dialog.waitFor({state:'hidden'});
  const task=space(gui).locator(`.bs-task[data-task-id="${created.value.taskId}"]`);const started=await command(gui,'task.start',()=>button(task,'开始任务').click());
  await waitFor(()=>gui.activeSignals.has(started.value.sessionId),'private task genuine running native turn');await chat(gui,sessionId,'V130_CHAT_DURING_PRIVATE_TASK');assert.equal(gui.activeSignals.get(started.value.sessionId).aborted,false);
  assert.ok((await gui.original(sessionId)).some(row=>row.type==='user/message'&&JSON.stringify(row.data).includes('V130_CHAT_DURING_PRIVATE_TASK')));gui.check('v130PrivateTaskRunsWhileSelectedChatRemainsResponsive',true);
  await command(gui,'task.stop',()=>button(task,'停止任务').click());await waitFor(()=>gui.app.ctx.dshBot.adapter.resources(started.value.sessionId).settled,'private task actual resources settle');
  await selectGroup(gui,groupId);assert.equal(await space(gui).getByText('空间私人后台任务',{exact:true}).count(),0);await button(space(gui),'发起会议').click();dialog=gui.page.getByRole('dialog',{name:'发起会议',exact:true});
  const topic='空间实际协作会议',materials=`受控测试材料 ${randomUUID()}`;
  await dialog.getByLabel('议题',{exact:true}).fill(topic);await dialog.getByLabel('共同材料',{exact:true}).fill(materials);gui.v130ApprovalGroupId=groupId;gui.v130ApprovalChannelPurpose='independent';gui.v130ApprovalChannel=undefined;
  const unregisterMeeting=registerIndependentApprovalPolicy(gui);
  const probeRoute=await createTrackedRoute(gui.page,'**/api/dsh.bot/command',async route=>{
    const request=payload(route.request());if(request?.action==='meeting.start'&&request.input.groupId===groupId&&request.input.topic===topic&&request.input.materials===materials)gui.v130ApprovalMeetingTarget={operationId:request.operationId,groupId};
    // Publish the observed original identity before forwarding unchanged bytes.
    // No response, UI, receipt, service, or native resource is substituted.
    await route.continue();
  });
  let begun;
  try {begun=await command(gui,'meeting.start',()=>button(dialog,'开始会议').click());await dialog.waitFor({state:'hidden'});await independentApproval(gui,groupId,begun.value.meetingId);} finally {gui.v130ApprovalGroupId=undefined;gui.v130ApprovalChannelPurpose=undefined;gui.v130ApprovalChannel=undefined;gui.v130ApprovalMeetingTarget=undefined;unregisterMeeting();await probeRoute.close();}
  const meetingId=begun.value.meetingId,meeting=space(gui).locator(`.bs-meeting[data-meeting-id="${meetingId}"]`);
  await gui.until(snapshot=>Object.keys(snapshot.meetings.find(row=>row.meetingId===meetingId)?.opinions??{}).length===2,'actual sealed independent opinions');
  const independent=gui.app.ctx.dshBot.store.read().meetings[meetingId];assert.equal(independent.phase,'independent');
  for(const opinion of Object.values(independent.opinions))assert.equal((await meeting.innerText()).includes(opinion.text),false);
  assert.match(await meeting.innerText(),/封存/);gui.check('v130MeetingIndependentOpinionsRemainSealedUntilAdvance',true);
  const unregisterPlan=registerPlanReviewTool(gui);gui.v130ChannelQuestion={groupId,meetingId,purpose:'meeting',kind:'plan-review'};
  try {
    await command(gui,'meeting.advance',()=>button(meeting,'下一阶段').click());
    await waitFor(()=>!!gui.v130ChannelQuestion.sessionId,'actual discussion member requests native plan review');
    const selected={...gui.v130ChannelQuestion},binding=gui.app.ctx.dshBot.store.read().sessions[selected.sessionId];
    assert.equal(binding.lineage.groupId,groupId);assert.equal(binding.lineage.meetingId,meetingId);assert.equal(binding.lineage.phase,'discussion');
    let panel=await channelQuestion(gui,selected.sessionId,'plan-review');await panel.locator('[data-plan-review-key]').waitFor();
    await bookmarkQuestion(gui,selected.sessionId);const plan=panel.locator('.bs-plan-document[aria-label="完整原生计划"] > pre');await plan.waitFor();assert.equal(await plan.innerText(),'# 本群受控计划\n\n保留原通道与原会议信息。\n\n第二段：验证原计划全文。\n\n- 最后一项：保留原请求回执。');
    await assertPlanPreviewEntry(gui,-1);await screenshot(gui,'v130-space-discussion-plan-review');
    await button(panel,'要求修改').click();await panel.waitFor({state:'hidden'});
    await assertPlanPreviewEntry(gui,0);
    assert.equal((await questionBookmark(gui,selected.sessionId)).closed,false,'Keyed discuss hides the question without cancellation');
    assert.equal((await gui.original(selected.sessionId)).some(row=>row.type==='tool/result'&&row.data.message?.toolCallId===selected.callId),false);
    assert.equal(await space(gui).locator('.bs-interaction [data-composer-input="true"]').count(),0);
    const reopen=space(gui).locator(`button[data-reopen-session-id="${selected.sessionId}"][data-call-id="${selected.callId}"]`);await reopen.waitFor();await reopen.click();
    panel=space(gui).locator(`.bs-interaction[data-session-id="${selected.sessionId}"]`);await panel.locator('[data-plan-review-key]').waitFor();
    await assertPlanPreviewEntry(gui,-1);
    assert.equal((await questionBookmark(gui,selected.sessionId)).same,true,'Reopen publishes the same original canonical plan carrier');
    gui.check('v130KeyedPlanReviewHideReopensSameOriginalCarrier',true);
    await button(panel,'同意执行').click();await questionUnmounted(gui,selected.sessionId);await assertPlanPreviewEntry(gui,0);
    await questionToolAudit(gui,selected.sessionId,selected.callId,'stock_v130_plan_review','保留原计划');
    gui.report.v130Space.discussionPlanReviewWitness=true;gui.check('v130MeetingDiscussionPlanReviewUsesExactChannelAndOriginalToolResult',true);
  } finally {gui.v130ChannelQuestion=undefined;unregisterPlan();}
  await gui.until(snapshot=>Object.keys(snapshot.meetings.find(row=>row.meetingId===meetingId)?.discussion??{}).length===2,'actual meeting discussion');
  await command(gui,'meeting.advance',()=>button(meeting,'下一阶段').click());await gui.until(snapshot=>!!snapshot.meetings.find(row=>row.meetingId===meetingId)?.decision,'actual coordinator decision');
  await button(meeting,'登记行动任务').click();dialog=gui.page.getByRole('dialog',{name:'登记行动任务',exact:true});
  await dialog.getByLabel('行动负责人',{exact:true}).selectOption(second.botId);await dialog.getByLabel('任务标题',{exact:true}).fill('空间会议行动');await dialog.getByLabel('目标',{exact:true}).fill('真实会议行动目标');await dialog.getByLabel('验收条件（每行一项）',{exact:true}).fill('保留行动任务原 ID');
  const action=await command(gui,'meeting.action',()=>button(dialog,'创建行动任务').click());await dialog.waitFor({state:'hidden'});
  const persisted=gui.app.ctx.dshBot.store.read(),actionId=action.value.taskId;assert.ok(persisted.meetings[meetingId].actions.includes(actionId));assert.equal(persisted.tasks[actionId].botId,second.botId);assert.equal(persisted.tasks[actionId].currentAttemptId,null);
  await space(gui).locator(`.bs-task[data-task-id="${actionId}"]`).waitFor();assert.equal(await space(gui).getByText('空间私人后台任务',{exact:true}).count(),0);
  gui.check('v130GroupContextShowsOnlyMeetingActionTasks',true);gui.check('v130MeetingAdvancesRealPhasesAndCreatesLinkedActionTask',true);await screenshot(gui,'v130-space-cooperation-light');await theme(gui,'dark');await screenshot(gui,'v130-space-cooperation-dark');await theme(gui,'light');
  await command(gui,'meeting.advance',()=>button(meeting,'下一阶段').click());
}
async function theme(gui,colorScheme) {await gui.page.emulateMedia({colorScheme});await waitFor(()=>gui.page.evaluate(dark=>document.body.hasAttribute('data-ds-dark-theme')===dark,colorScheme==='dark'),'actual native theme follows controlled environment');await paint(gui.page);}
async function responsive(gui,groupId) {
  await gui.page.setViewportSize({width:1080,height:900});await paint(gui.page);assert.equal(await space(gui).locator('.bs-context').isVisible(),false);await screenshot(gui,'v130-space-medium-light');
  await gui.page.setViewportSize({width:760,height:900});await paint(gui.page);const scope=space(gui);
  for(const name of ['会话','上下文']) {await button(scope,name).waitFor();const box=await button(scope,name).boundingBox();assert.ok(box&&box.width>=40&&box.height>=40&&box.x>=0&&box.x+box.width<=760);}
  for(const [name,attribute] of [['会话','data-rail-open'],['上下文','data-context-open']]){
    const trigger=button(scope,name);await trigger.click();await waitFor(async()=>(await scope.getAttribute(attribute))==='true','actual narrow drawer opens');
    await gui.page.keyboard.press('Escape');await waitFor(async()=>(await scope.getAttribute(attribute))==='false','actual narrow drawer Escape closes');
    assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,'Drawer Escape restores its exact opening control');
  }
  gui.check('v130NarrowDrawersEscapeRestoreFocus',true);
  await button(scope,'会话').click();await scope.locator(`.bs-contact[data-group-id="${groupId}"]`).click();await scope.getByLabel('群消息',{exact:true}).waitFor();
  const send=await button(scope,'发送消息').boundingBox();assert.ok(send&&send.x>=0&&send.x+send.width<=760);await button(scope,'上下文').click();await scope.locator('.bs-context').waitFor();
  gui.check('v130NarrowSpaceControlsRemainReachable',true);await screenshot(gui,'v130-space-narrow-light');
  await button(scope,'关闭上下文').click();await gui.page.setViewportSize({width:1600,height:1000});await paint(gui.page);const trigger=button(scope,'新建 Bot');await trigger.click();const dialog=gui.page.getByRole('dialog',{name:'新建 Bot',exact:true});await dialog.waitFor();await gui.page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  gui.check('v130SpaceModalEscapeRestoresTriggerFocus',true);
  await theme(gui,'dark');await screenshot(gui,'v130-space-group-dark');
  assert.ok(['v130-space-private-light.png','v130-space-private-dark.png','v130-space-group-light.png','v130-space-cooperation-light.png','v130-space-cooperation-dark.png','v130-space-medium-light.png','v130-space-narrow-light.png','v130-space-group-dark.png'].every(name=>gui.report.v130Space.screenshots.includes(name)));
  gui.check('v130SpaceLightDarkPrivateGroupCooperationScreenshots',true);await theme(gui,'light');
}
async function disableChecks(gui,sessionId,main) {
  // This ordinary Agent belongs to the stock controller, not the plugin.
  const workspace=await gui.app.ctx.workspaceRegistry.create(join(gui.root,'work'));
  const ordinary=await gui.app.ctx.sessionController.create({workspaceId:workspace.id},new AbortController().signal);gui.ordinaryHold=ordinary.sessionId;
  await gui.app.ctx.sessionController.prompt({requestId:randomUUID(),sessionId:ordinary.sessionId,mode:'queue',content:[{type:'text',text:'V130 unrelated stock conversation'}]},new AbortController().signal);
  await waitFor(()=>gui.activeSignals.has(ordinary.sessionId),'unrelated genuine ordinary turn');
  await selectContact(gui,gui.app.ctx.dshBot.store.read().sessions[sessionId].botId,sessionId);assert.equal((await clientFacts(gui,[sessionId])).references[sessionId],1);assert.deepEqual((await clientFacts(gui)).mainIds,main);
  try {
    await gui.app.ctx.pluginManager.setBundleEnabled('dsh-bot',false);await waitFor(()=>!gui.app.ctx.get('dshBot'),'space plugin disabled');await space(gui).waitFor({state:'hidden'});
    await waitFor(async()=>(await clientFacts(gui,[sessionId])).references[sessionId]===0,'owned embedded reference released after actual disable');
    assert.equal(gui.activeSignals.get(ordinary.sessionId).aborted,false);assert.ok(gui.app.ctx.agents.get(ordinary.sessionId));
    gui.check('v130NativeReferencesReleaseOnSwitchAndDisable',true);gui.check('v130SpaceDisablePreservesUnrelatedNativeConversation',true);
  } finally {
    await gui.app.ctx.pluginManager.setBundleEnabled('dsh-bot',true);await waitFor(()=>!!gui.app.ctx.get('dshBot'),'space plugin reenabled');gui.ordinaryHold=undefined;
    await gui.app.ctx.sessionController.cancel({sessionId:ordinary.sessionId});await gui.app.ctx.agents.get(ordinary.sessionId).whenIdle();
  }
  await openSpace(gui);
}

function registerApprovalTool(gui) {
  return gui.app.ctx.tools.register({name:'stock_v130_approval',description:'Harmless native approval chain qualification',parameters:{type:'object',properties:{},additionalProperties:false},
    output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute(_args,exec){
      const outcome=await gui.app.ctx.approval.request({agent:exec.agent,callId:exec.callId,toolName:'stock_v130_approval',reason:'受控原生审批链验收',signal:exec.signal});
      if(outcome==='allowed-once') {gui.v130ApprovalExecutions??=new Map();gui.v130ApprovalExecutions.set(exec.agent.id,(gui.v130ApprovalExecutions.get(exec.agent.id)??0)+1);}
      return outcome;
    }});
}
async function channelApproval(gui,sessionId,outcome) {
  await waitFor(async()=>(await clientFacts(gui,[sessionId])).pending[sessionId]==='approval','actual exact-channel pending native approval');
  const action=space(gui).locator(`button[data-pending-session-id="${sessionId}"]`);await action.waitFor();await action.click();
  const scope=space(gui).locator(`.bs-interaction[data-session-id="${sessionId}"]`);await scope.waitFor();const approval=scope.locator('[data-approval-key]');await approval.waitFor();
  assert.equal((await clientFacts(gui,[sessionId])).references[sessionId],1);
  assert.equal(await scope.locator('[data-message-id]').count(),0,'Approval-only native factory exposes no channel history');
  const agent=gui.app.ctx.agents.get(sessionId);assert.ok(agent);await gui.app.ctx.sessions.flush(agent.session);
  const original=await gui.original(sessionId),body=await scope.innerText();
  for(const event of original.filter(row=>row.type==='user/message'||row.type==='assistant/message'))
    for(const part of event.data.message?.content??event.data.content??[])
      if(part.type==='text'&&part.text)assert.equal(body.includes(part.text),false,'Native approval surface does not render original channel messages');
  await screenshot(gui,outcome==='allowed-once'?'v130-space-group-native-approval':'v130-space-independent-native-approval');
  await button(approval,outcome==='allowed-once'?'允许一次':'拒绝').click();await scope.waitFor({state:'hidden'});
  await waitFor(async()=>(await clientFacts(gui,[sessionId])).references[sessionId]===0,'exact channel interaction releases owned reference');
  assert.equal(await space(gui).locator('.bs-interaction [data-composer-input="true"]').count(),0,'Resolved native approval unmounts before ordinary draft fallback');
  gui.check('v130ResolvedChannelApprovalUnmountsBeforeDraftFallback',true);
}
async function approvalAudit(gui,sessionId,outcome,toolName='stock_v130_approval') {
  await waitFor(async()=>{const events=await gui.original(sessionId);return events.some(row=>row.type==='approval/decided'&&row.data.outcome===outcome);},'real exact-channel native approval audit');
  const events=await gui.original(sessionId),asked=events.filter(row=>row.type==='approval/asked'&&row.data.toolName===toolName);
  assert.equal(asked.length,1);assert.ok(asked[0].data.callId);
  assert.ok(events.some(row=>row.type==='approval/decided'&&row.data.id===asked[0].data.id&&row.data.outcome===outcome));
  assert.ok(events.some(row=>row.type==='tool/result'&&JSON.stringify(row.data).includes(outcome)));
  assert.equal(gui.v130ApprovalExecutions?.get(sessionId)??0,outcome==='allowed-once'?1:0,'Only the exact permitted harmless tool operation executes');
}
async function groupApproval(gui,groupId,otherGroupId) {
  const unregister=registerApprovalTool(gui);gui.v130ApprovalGroupId=groupId;gui.v130ApprovalChannelPurpose='group';gui.v130ApprovalChannel=undefined;
  try {
    const row=await groupPost(gui,groupId,'V130_GROUP_NATIVE_APPROVAL');await waitFor(()=>!!gui.v130ApprovalChannel,'genuine group member asks native approval');const sessionId=gui.v130ApprovalChannel;
    const binding=gui.app.ctx.dshBot.store.read().sessions[sessionId];assert.equal(binding.lineage.groupId,groupId);assert.equal(binding.lineage.roundId,row.value.roundId);
    await selectGroup(gui,otherGroupId);assert.equal(await space(gui).locator(`button[data-pending-session-id="${sessionId}"]`).count(),0,'Another group never receives this native approval');
    await selectGroup(gui,groupId);await channelApproval(gui,sessionId,'allowed-once');
    await waitFor(()=>gui.app.ctx.dshBot.store.read().groups[groupId].rounds[row.value.roundId].state==='complete','approved original group member genuinely continues');
    await approvalAudit(gui,sessionId,'allowed-once');assert.ok(gui.app.ctx.dshBot.store.read().groups[groupId].messages.some(message=>message.source?.sessionId===sessionId&&message.producer.kind==='bot'));
    gui.report.v130Space.groupApprovalWitness=true;gui.check('v130GroupApprovalUsesExactNativeChannelAndAuditedContinuation',true);await screenshot(gui,'v130-space-group-approval-complete');
  } finally {gui.v130ApprovalGroupId=undefined;gui.v130ApprovalChannelPurpose=undefined;gui.v130ApprovalChannel=undefined;unregister();}
}
async function independentApproval(gui,groupId,meetingId) {
  await waitFor(()=>!!gui.v130ApprovalChannel,'genuine independent meeting member asks native approval');const sessionId=gui.v130ApprovalChannel,binding=gui.app.ctx.dshBot.store.read().sessions[sessionId];
  assert.equal(isCurrentIndependentApprovalProbe(gui.app.ctx.dshBot.store.read(),binding,gui.v130ApprovalMeetingTarget),true,'Probe belongs to the exact initiating receipt and still-current original participant');
  assert.equal(binding.lineage.groupId,groupId);assert.equal(binding.lineage.meetingId,meetingId);assert.equal(binding.lineage.phase,'independent');
  const meeting=space(gui).locator(`.bs-meeting[data-meeting-id="${meetingId}"]`);assert.match(await meeting.innerText(),/封存/);
  await channelApproval(gui,sessionId,'rejected');await approvalAudit(gui,sessionId,'rejected','dsh_bot');
  const row=gui.app.ctx.dshBot.store.read().meetings[meetingId];assert.equal(row.phase,'independent');
  for(const opinion of Object.values(row.opinions))assert.equal((await space(gui).innerText()).includes(opinion.text),false,'Independent native opinions stay sealed after rejection');
  gui.report.v130Space.independentApprovalWitness=true;gui.check('v130IndependentMeetingApprovalRejectsExactToolWithoutOpinionLeak',true);
}

function registerIndependentApprovalPolicy(gui) {
  // Independent channels deliberately disallow other native tools. Ask on the
  // existing allowed read-only plugin tool through the official policy seam;
  // the unchanged monotonic Bot guard still runs after the approval decision.
  const selected=exec=>exec.agent?.id===gui.v130ApprovalChannel&&exec.name==='dsh_bot'&&exec.arguments.action==='help'&&exec.callId===`v130-channel-approval-${exec.agent.id}`;
  const policy=gui.app.ctx.on('tools/pre-execute',async(exec,next)=>selected(exec)?{kind:'ask',reason:'受控独立会议原生审批验收'}:next(),{global:true});
  const observer=gui.app.ctx.on('tools/execute',async(exec,next)=>{
    if(selected(exec)){gui.v130ApprovalExecutions??=new Map();gui.v130ApprovalExecutions.set(exec.agent.id,(gui.v130ApprovalExecutions.get(exec.agent.id)??0)+1);}
    return next();
  },{global:true});
  return ()=>{observer();policy();};
}

function registerPlanReviewTool(gui) {
  // A harmless genuine tool turn asks the official question service to render
  // its plan-review intent. It does not instantiate PendingQuestion or alter
  // plan mode, policy, Session, renderer, or the independent-channel guard.
  return gui.app.ctx.tools.register({name:'stock_v130_plan_review',description:'Harmless native plan-review UI qualification',parameters:{type:'object',properties:{},additionalProperties:false},
    output:{schema:{type:'object'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},
    async execute(_args,exec){return gui.app.ctx.userQuestions.ask({agent:exec.agent,signal:exec.signal,wait:{callId:exec.callId},questions:[{id:'v130-plan-review',question:'确认本群受控计划',detail:'# 本群受控计划\n\n保留原通道与原会议信息。\n\n第二段：验证原计划全文。\n\n- 最后一项：保留原请求回执。',options:[{label:'保留原计划'},{label:'继续讨论'}],intent:{kind:'plan-review',approve:'保留原计划',callId:exec.callId}}]});}});
}
async function questionUnmounted(gui,sessionId) {
  await space(gui).locator(`.bs-interaction[data-session-id="${sessionId}"]`).waitFor({state:'hidden'});
  await waitFor(async()=>(await clientFacts(gui,[sessionId])).references[sessionId]===0,'native question route releases its exact owned lease');
  assert.equal(await space(gui).locator('.bs-interaction [data-composer-input="true"]').count(),0,'Closed native question has no free-message fallback');
}
async function channelQuestion(gui,sessionId,kind) {
  await waitFor(async()=>(await clientFacts(gui,[sessionId])).pending[sessionId]===kind,'canonical exact-channel native question kind');
  const action=space(gui).locator(`button[data-pending-session-id="${sessionId}"]`);await action.waitFor();await action.click();
  const scope=space(gui).locator(`.bs-interaction[data-session-id="${sessionId}"]`);await scope.waitFor();
  await scope.locator(kind==='question'?'[data-question-key]':'[data-plan-review-key]').waitFor();
  assert.equal((await clientFacts(gui,[sessionId])).references[sessionId],1);
  assert.equal(await scope.locator('[data-message-id]').count(),0,'Native question route does not expose channel history');
  assert.equal(await scope.locator('[data-composer-input="true"]').isVisible(),false,'Native question takeover does not expose a free-message input');
  const body=await scope.innerText(),requested=await gui.page.evaluate(id=>window.__stockV130ClientServices.uiSession.sessionStatus.getSnapshot().get(id)?.pendingInteraction?.questions?.flatMap(row=>[row.question,row.detail,row.header,...(row.options??[]).flatMap(option=>[option.label,option.description])]).filter(text=>typeof text==='string')??[],sessionId);
  assertNativeQuestionHistoryExcluded(body,await gui.original(sessionId),requested);
  return scope;
}
async function questionToolAudit(gui,sessionId,callId,name,selected) {
  await waitFor(async()=>{const events=await gui.original(sessionId);return events.some(row=>row.type==='tool/result'&&row.data.message?.toolCallId===callId);},'original native question tool result');
  const events=await gui.original(sessionId),calls=events.filter(row=>row.type==='tool/call'&&row.data.callId===callId),results=events.filter(row=>row.type==='tool/result'&&row.data.message?.toolCallId===callId);
  assert.equal(calls.length,1);assert.equal(calls[0].data.name,name);assert.equal(results.length,1);assert.notEqual(results[0].data.message.isError,true);
  const answer=JSON.parse(results[0].data.message.content.filter(part=>part.type==='text').map(part=>part.text).join(''));
  assert.deepEqual(answer.answers[0].selected,[selected]);
  assert.equal(answer.answers[0].id,name==='ask_user_question'?'v130-channel-choice':'v130-plan-review');
  // The official question chain audits ordinary tool/call and tool/result. It
  // does not produce approval/asked or approval/decided for question answers.
}
async function groupQuestions(gui,groupId,otherGroupId) {
  const before=await clientFacts(gui);gui.v130ChannelQuestion={groupId,purpose:'group',kind:'question',text:'V130_GROUP_NATIVE_QUESTION'};
  try {
    const posted=await groupPost(gui,groupId,'V130_GROUP_NATIVE_QUESTION');await waitFor(()=>!!gui.v130ChannelQuestion.sessionId,'genuine native group ask_user_question call');
    const selected={...gui.v130ChannelQuestion},binding=gui.app.ctx.dshBot.store.read().sessions[selected.sessionId];
    assert.equal(binding.lineage.groupId,groupId);assert.equal(binding.lineage.roundId,posted.value.roundId);
    await selectGroup(gui,otherGroupId);assert.equal(await space(gui).locator(`button[data-pending-session-id="${selected.sessionId}"]`).count(),0);
    await selectGroup(gui,groupId);let panel=await channelQuestion(gui,selected.sessionId,'question');
    await screenshot(gui,'v130-space-group-native-question');await gui.page.keyboard.press('Escape');await questionUnmounted(gui,selected.sessionId);
    assert.equal((await clientFacts(gui,[selected.sessionId])).pending[selected.sessionId],'question','Closing the space dialog preserves the original unanswered native question');
    assert.equal(gui.activeSignals.get(selected.sessionId).aborted,false);
    assert.equal(await space(gui).locator(`button[data-pending-session-id="${selected.sessionId}"]`).evaluate(el=>el===document.activeElement),true);
    gui.check('v130ChannelQuestionCloseUnmountsWithoutFallbackOrLease',true);
    panel=await channelQuestion(gui,selected.sessionId,'question');const option=panel.getByRole('radio',{name:'保留原通道',exact:true});await option.click();await option.press('Enter');await questionUnmounted(gui,selected.sessionId);
    await questionToolAudit(gui,selected.sessionId,selected.callId,'ask_user_question','保留原通道');
    await waitFor(()=>gui.app.ctx.dshBot.store.read().groups[groupId].rounds[posted.value.roundId].state==='complete','answered original group question resumes its native member');
    assert.ok(gui.app.ctx.dshBot.store.read().groups[groupId].messages.some(row=>row.source?.sessionId===selected.sessionId&&row.producer.kind==='bot'));
    assert.equal((await clientFacts(gui)).generation,before.generation);assert.deepEqual((await clientFacts(gui)).mainIds,before.mainIds);
    gui.report.v130Space.groupQuestionWitness=true;gui.check('v130GroupNativeQuestionUsesExactChannelAndOriginalToolResult',true);
  } finally {gui.v130ChannelQuestion=undefined;}
  gui.v130ChannelQuestion={groupId,purpose:'group',kind:'question',text:'V130_GROUP_QUESTION_REMOVAL'};
  try {
    const posted=await groupPost(gui,groupId,'V130_GROUP_QUESTION_REMOVAL');await waitFor(()=>!!gui.v130ChannelQuestion.sessionId,'original group question before round stop');
    const selected={...gui.v130ChannelQuestion},panel=await channelQuestion(gui,selected.sessionId,'question');
    await button(panel,'放弃整组问题').click();
    await questionUnmounted(gui,selected.sessionId);await waitFor(async()=>(await clientFacts(gui,[selected.sessionId])).pending[selected.sessionId]===null,'original native question removed after native cancellation');
    assert.equal(await space(gui).locator(`button[data-pending-session-id="${selected.sessionId}"]`).count(),0);
    assert.equal((await clientFacts(gui)).generation,before.generation);assert.deepEqual((await clientFacts(gui)).mainIds,before.mainIds);
    await waitFor(async()=>(await gui.original(selected.sessionId)).some(row=>row.type==='tool/result'&&row.data.message?.toolCallId===selected.callId),'native cancellation commits its original tool result');
    const events=await gui.original(selected.sessionId);assert.equal(events.filter(row=>row.type==='tool/call'&&row.data.callId===selected.callId).length,1);assert.equal(events.filter(row=>row.type==='tool/result'&&row.data.message?.toolCallId===selected.callId&&row.data.message.isError===true).length,1);
    await waitFor(()=>gui.app.ctx.dshBot.store.read().groups[groupId].rounds[posted.value.roundId].state==='complete','group continues after native legacy question cancellation');
    gui.check('v130ChannelQuestionRemovalUnmountsAndPreservesOriginalGeneration',true);
  } finally {gui.v130ChannelQuestion=undefined;}
}
async function cancelledIndependentMeeting(gui,groupId) {
  await selectGroup(gui,groupId);const history=structuredClone(gui.app.ctx.dshBot.store.read().groups[groupId].messages);
  await button(space(gui),'发起会议').click();const dialog=gui.page.getByRole('dialog',{name:'发起会议',exact:true});
  await dialog.getByLabel('议题',{exact:true}).fill('取消前未揭示会议');await dialog.getByLabel('共同材料',{exact:true}).fill('独立意见只保留原生历史');
  const started=await command(gui,'meeting.start',()=>button(dialog,'开始会议').click());await dialog.waitFor({state:'hidden'});const meetingId=started.value.meetingId;
  await gui.until(snapshot=>Object.keys(snapshot.meetings.find(row=>row.meetingId===meetingId)?.opinions??{}).length===2,'both original unrevealed independent opinions');
  const original=structuredClone(gui.app.ctx.dshBot.store.read().meetings[meetingId]);assert.equal(original.phase,'independent');assert.notEqual(original.revealedEpoch,original.epoch);
  const meeting=space(gui).locator(`.bs-meeting[data-meeting-id="${meetingId}"]`);await command(gui,'meeting.cancel',()=>button(meeting,'取消会议').click());
  const current=gui.app.ctx.dshBot.store.read().meetings[meetingId];assert.equal(current.phase,'cancelled');assert.equal(current.groupId,groupId);assert.equal(current.epoch,original.epoch);assert.deepEqual(current.opinions,original.opinions);assert.notEqual(current.revealedEpoch,current.epoch);
  assert.deepEqual(gui.app.ctx.dshBot.store.read().groups[groupId].messages,history,'Unrevealed cancellation does not publish opinions into the group transcript');
  for(const opinion of Object.values(current.opinions))assert.equal((await space(gui).innerText()).includes(opinion.text),false,'Cancelled current epoch has no proof permitting opinion display');
  for(const participant of Object.values(original.participants)){const binding=gui.app.ctx.dshBot.store.read().sessions[participant.sessionId];assert.equal(binding.lineage.groupId,groupId);assert.equal(binding.lineage.meetingId,meetingId);assert.equal(binding.lineage.epoch,original.epoch);assert.ok((await gui.original(participant.sessionId)).some(row=>row.type==='assistant/message'));}
  gui.report.v130Space.cancelledOpinionsSealed=true;gui.check('v130CancelledUnrevealedMeetingKeepsOpinionsSealedAndHistory',true);await screenshot(gui,'v130-space-cancelled-unrevealed-meeting');
}
async function bookmarkQuestion(gui,sessionId) {
  await gui.page.evaluate(id=>{window.__stockV130QuestionBookmark=window.__stockV130ClientServices.uiSession.sessionStatus.getSnapshot().get(id)?.pendingInteraction;},sessionId);
}
async function questionBookmark(gui,sessionId) {
  return gui.page.evaluate(id=>{const saved=window.__stockV130QuestionBookmark,current=window.__stockV130ClientServices.uiSession.sessionStatus.getSnapshot().get(id)?.pendingInteraction;return {same:saved===current,closed:saved?.getSnapshot().closed??null,key:current?.key??null,state:current?.getSnapshot?.().state??null,channel:current?.getSnapshot?.().channel??null};},sessionId);
}
async function assertPlanPreviewEntry(gui,priority) {
  await waitFor(()=>gui.page.evaluate(expected=>{const slots=window.__stockV130ClientCtx.slots,entry=slots.entriesOfSlot('conversation.plan-review.actions').find(row=>row.options.id==='@deepseek-ai/dsh-client-ui-plan');return !!entry&&(entry.options.priority??0)===expected;},priority),'public native plan-preview list cell has its expected bounded winner');
}
async function timedGroupQuestion(gui,groupId,otherGroupId) {
  const question={groupId,purpose:'group',kind:'question',text:'V130_TIMED_GROUP_QUESTION',timed:true,release:deferred()};gui.v130ChannelQuestion=question;
  let timedPlugin;
  const created=gui.app.ctx.on('agent/created',async({agent})=>{
    const state=gui.app.ctx.dshBot.store.read(),binding=state.sessions[agent.id],group=state.groups[groupId];
    if(binding?.purpose!=='group'||binding.lineage.groupId!==groupId||question.sessionId)return;
    const cause=group.messages.find(row=>row.messageId===group.rounds[binding.lineage.roundId]?.causeMessageId);
    if(cause?.text!==question.text)return;
    question.sessionId=agent.id;timedPlugin=agent.ctx.plugin(OfficialAskUser,{mode:'timed',timeout:1});await timedPlugin.await();
  },{global:true});
  const unregisterHold=gui.app.ctx.tools.register({name:'stock_v130_question_hold',description:'Hold one harmless native tool step for bounded timed-question qualification',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
    async execute(_args,exec){assert.equal(exec.agent.id,question.sessionId);question.nativeToolHeld=true;let aborted;
      const cancel=new Promise(resolve=>{aborted=resolve;if(exec.signal.aborted)resolve();else exec.signal.addEventListener('abort',resolve,{once:true});});
      try{await Promise.race([question.release.promise,cancel]);exec.signal.throwIfAborted();return 'harmless held native step released';}finally{exec.signal.removeEventListener('abort',aborted);}}});
  try {
    const posted=await groupPost(gui,groupId,question.text);await waitFor(()=>question.issued&&question.nativeToolHeld,'official timed tool and genuine held tool in one admitted native step');
    const sessionId=question.sessionId;await waitFor(async()=>{const events=await gui.original(sessionId);return events.some(row=>row.type==='tool/result'&&row.data.message?.toolCallId===question.callId);},'official timed question reaches its original pending result');
    await waitFor(async()=>{const facts=await questionBookmark(gui,sessionId);return facts.state==='continued'&&facts.channel==='rpc';},'native timed question transitions to its real late-answer RPC carrier');
    const originalResult=(await gui.original(sessionId)).find(row=>row.type==='tool/result'&&row.data.message?.toolCallId===question.callId),before=await clientFacts(gui);
    const schemas=(await gui.original(sessionId)).filter(row=>row.type==='request/header').flatMap(row=>row.data.header.tools??[]);assert.ok(schemas.some(row=>row.name==='ask_user_question'&&row.parameters?.properties?.timeout),'The real logged official tool schema enables timed projection');
    const value=JSON.parse(originalResult.data.message.content.filter(part=>part.type==='text').map(part=>part.text).join(''));assert.equal(value.pending,true);assert.equal(value.callId,question.callId);
    await bookmarkQuestion(gui,sessionId);await channelQuestion(gui,sessionId,'question');await gui.page.keyboard.press('Escape');
    await selectGroup(gui,otherGroupId);await waitFor(async()=>(await clientFacts(gui,[sessionId])).references[sessionId]===0,'leaving group releases its timed-question recovery lease');
    await selectGroup(gui,groupId);await channelQuestion(gui,sessionId,'question');await screenshot(gui,'v130-space-timed-question-continued');
    await gui.context.setOffline(true);
    try {await waitFor(async()=>(await clientFacts(gui)).generation===null,'real browser transport loses its original generation');await waitFor(async()=>(await clientFacts(gui,[sessionId])).references[sessionId]===0,'disconnect invalidates old question lease');assert.equal(await space(gui).locator('.bs-interaction').count(),0);}finally{await gui.context.setOffline(false);}
    await waitFor(async()=>(await clientFacts(gui)).generation>before.generation,'real SDK connection establishes a new generation');
    await selectGroup(gui,groupId);const panel=await channelQuestion(gui,sessionId,'question');
    assert.equal((await questionBookmark(gui,sessionId)).same,false,'New generation uses a new canonical carrier discovered from actual projection');
    assert.deepEqual((await clientFacts(gui)).mainIds,before.mainIds);gui.check('v130QuestionReconnectDiscardsCarrierAndRestoresCurrentProjection',true);
    const option=panel.getByRole('radio',{name:'保留原通道',exact:true});await option.click();await option.press('Enter');
    await panel.waitFor({state:'hidden'});question.release.resolve();
    await waitFor(async()=>originalTimedQuestionReplies(await gui.original(sessionId),question.callId).length>0,'late native RPC admits original-call user reply');
    const events=await gui.original(sessionId),answers=originalTimedQuestionReplies(events,question.callId);
    assert.equal(answers.length,1);assert.ok(JSON.stringify(answers[0].data.content).includes('保留原通道'));assert.deepEqual(events.find(row=>row.type==='tool/result'&&row.data.message?.toolCallId===question.callId),originalResult,'Late reply preserves the original timed result');
    await waitFor(()=>gui.app.ctx.dshBot.store.read().groups[groupId].rounds[posted.value.roundId].state==='complete','late answer stays within the original bounded group round');await questionUnmounted(gui,sessionId);
    assert.equal(gui.report.requests.filter(row=>row.sessionId===sessionId&&row.purpose==='conversation').length,2);gui.check('v130TimedQuestionLateReplyPreservesOriginalCallAndCurrentChannel',true);
    assert.equal(gui.app.ctx.dshBot.store.read().sessions[sessionId].state,'settled');assert.equal(await space(gui).locator(`button[data-pending-session-id="${sessionId}"],button[data-reopen-session-id="${sessionId}"]`).count(),0);
    await selectGroup(gui,otherGroupId);await selectGroup(gui,groupId);assert.equal((await clientFacts(gui,[sessionId])).references[sessionId],0);assert.equal(await space(gui).locator(`.bs-interaction[data-session-id="${sessionId}"]`).count(),0);gui.check('v130SettledChannelQuestionCannotReactivateAfterCompletion',true);
  } finally {question.release.resolve();created();gui.v130ChannelQuestion=undefined;await timedPlugin?.dispose();unregisterHold();await gui.context.setOffline(false);}
}
async function managementTargets(gui,botId,groupId) {
  await selectBot(gui,botId);await button(space(gui),'管理记忆与资料').click();await space(gui).waitFor({state:'hidden'});
  await waitFor(async()=>gui.page.getByLabel('所属 Bot',{exact:true}).inputValue().then(value=>value===botId),'management opens the exact selected same-name Bot');
  await openSpace(gui);await selectGroup(gui,groupId);await button(space(gui),'管理成员与群设置').click();await space(gui).waitFor({state:'hidden'});
  const card=gui.page.locator(`[id="dsh-resource-${groupId}"]`);await card.waitFor();const box=await card.boundingBox();assert.ok(box&&box.y<1000&&box.y+box.height>0,'group management scrolls its exact resource into view');
  await openSpace(gui);await selectGroup(gui,groupId);gui.check('v130ManagementOpensExactSelectedBotAndGroupTargets',true);
}
