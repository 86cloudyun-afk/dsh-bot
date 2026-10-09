import assert from 'node:assert/strict';
import manifest from '../../package.json' with {type:'json'};
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {controlledProvider, waitFor} from './stock-gui-runtime.mjs';

const button = (scope, name) => scope.getByRole('button', {name, exact:true});
const v11Card = (gui, title) => gui.page.locator('section.card').filter({has:gui.page.getByRole('heading',{name:title,level:2,exact:true})});
const article = (scope, text) => scope.locator('article.card').filter({hasText:text});
const details = (scope, title) => {
  const page=typeof scope.page==='function'?scope.page():scope;
  const exact=new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`);
  return scope.locator('details').filter({has:page.locator('summary').filter({hasText:exact})}).first();
};
const hash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const canonical = value => Array.isArray(value)?`[${value.map(canonical).join(',')}]`:value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`:JSON.stringify(value);

// Observe the real browser RPC. No replacement transport or synthetic response.
async function uiRpc(gui, action, interact, {errorCode}={}) {
  const observed={action,requestObserved:false,responseObserved:false,interactionComplete:false};
  gui.report.v11Ui.lastRpc=observed;
  const matches=request=>{
    try {return request.postDataJSON()?.payload?.action===action;}
    catch {return false;}
  };
  const onRequest=request=>{if(matches(request))observed.requestObserved=true;};
  gui.page.on('request',onRequest);
  const responsePromise=gui.page.waitForResponse(response=>{
    if(!matches(response.request()))return false;
    observed.responseObserved=true;
    return true;
  });
  let response;
  try {
    [,response]=await Promise.all([(async()=>{await interact();observed.interactionComplete=true;})(),responsePromise]);
  } finally {
    gui.page.off('request',onRequest);
    if(action==='material.page')observed.readerMounted=await button(gui.page,'关闭正文').count()===1;
  }
  const request=response.request().postDataJSON().payload,
    reply=(await response.json()).result;
  if(errorCode) {
    assert.equal(reply?.ok,false);
    assert.equal(reply.error.code,errorCode);
  } else assert.equal(reply?.ok,true,`${action} failed: ${reply?.error?.code??'missing reply'}`);
  return {request,value:reply?.value,error:reply?.error};
}

function receipt(gui, rpc) {
  const operation=gui.app.ctx.dshBot.store.read().operations[rpc.request.operationId];
  assert.ok(operation,`Missing durable ${rpc.request.action} receipt`);
  assert.equal(operation.action,rpc.request.action);
  if(['session.configure','session.fork'].includes(rpc.request.action)) {
    assert.equal(operation.result.sessionId,rpc.value.sessionId);
    const finalized=gui.app.ctx.dshBot.store.read().operations[operation.result.statusOperationId];
    assert.ok(finalized,'Native session operation needs a durable finalized receipt');
    assert.deepEqual(finalized.result,rpc.value);
  } else if(rpc.request.action==='task.start') {
    // The native start returns the live attempt after session admission; its
    // durable first receipt retains the reserved identities before that step.
    assert.equal(operation.result.attemptId,rpc.value.attemptId);
    assert.equal(operation.result.taskId,rpc.value.taskId);
  } else assert.deepEqual(operation.result,rpc.value);
  return operation;
}

async function ownSessionControls(gui) {
  const count=gui.report.requests.length,contactId=gui.contactId,service=gui.app.ctx.dshBot,
    defaults=structuredClone(gui.app.ctx.agentDefaultModel.currentSelection());
  await waitFor(()=>{
    const agent=gui.app.ctx.agents.get(contactId);
    return service.adapter.resources(contactId).settled&&(!agent||!agent.inbox.nextTurn.length&&!agent.inbox.nextStep.length);
  },'original native contact is quiescent before UI configuration');
  await gui.workbench('会话管理');
  await button(gui.page,'刷新会话').click();
  const session=gui.page.locator('article.card').filter({has:gui.page.locator('small').filter({hasText:contactId})});
  await gui.expand(session,'配置与接续');
  const control=details(session,'配置与接续'),old=service.store.read().sessions[contactId],model={provider:controlledProvider,model:'model-b'};
  await control.getByLabel('会话名称',{exact:true}).fill('V11_GUI_CONFIGURED_CONTACT');
  await control.getByLabel('此会话模型',{exact:true}).selectOption(JSON.stringify(model));
  const configured=await uiRpc(gui,'session.configure',()=>button(control,'保存此会话配置').click());
  receipt(gui,configured);
  assert.equal(configured.request.input.expectedVersion,old.revision);
  assert.equal(configured.value.sessionId,contactId);
  assert.equal(configured.value.revision,old.revision+1);
  assert.deepEqual(configured.value.model,model);
  assert.equal(configured.value.name,'V11_GUI_CONFIGURED_CONTACT');
  const history=await service.adapter.readNative(contactId),evidence=configured.value.nativeConfigEvidence;
  assert.equal(history.events.find(row=>row.seq===evidence.titleSeq)?.data.title,'V11_GUI_CONFIGURED_CONTACT');
  assert.deepEqual(history.events.find(row=>row.seq===evidence.modelSeq)?.data,model);
  assert.deepEqual(gui.app.ctx.agentDefaultModel.currentSelection(),defaults);
  assert.equal(gui.report.requests.length,count);
  gui.check('v11OwnedContactUIConfigureWritesNativeTitleAndScopedModelWithoutGlobalChange',true);
  const boundary=history.events.findLast(row=>row.type==='turn/end')?.seq;
  assert.ok(Number.isSafeInteger(boundary),'Original contact has a completed native turn to seed');
  await control.getByLabel('新会话名称',{exact:true}).fill('V11_GUI_SEEDED_FORK');
  // The default fork boundary is the last completed native turn, preserving
  // exact historical events even though the parent model was just configured.
  const forked=await uiRpc(gui,'session.fork',()=>button(control,'创建接续会话').click());
  receipt(gui,forked);
  assert.notEqual(forked.value.sessionId,contactId);
  assert.equal(forked.value.botId,old.botId);
  assert.equal(forked.value.name,'V11_GUI_SEEDED_FORK');
  assert.deepEqual(forked.value.model,model);
  assert.equal(forked.value.source.sessionId,contactId);
  assert.equal(forked.value.source.eventSeq,boundary);
  assert.equal(forked.value.source.checksum,hash(canonical({header:history.header,events:history.events.slice(0,boundary+1)})));
  const nativeFork=await service.adapter.readNative(forked.value.sessionId);
  assert.deepEqual(nativeFork.events.slice(0,boundary+1),history.events.slice(0,boundary+1));
  assert.equal(nativeFork.header.parentSession,contactId);
  assert.equal(nativeFork.header.isSeeded,true);
  assert.equal(gui.app.ctx.agents.get(forked.value.sessionId).session.inheritedEventCount,boundary+1);
  assert.ok(nativeFork.events.some(row=>row.type==='session/title'&&row.data.title==='V11_GUI_SEEDED_FORK'));
  assert.deepEqual(gui.app.ctx.agentDefaultModel.currentSelection(),defaults);
  assert.equal(gui.report.requests.length,count);
  await gui.page.locator('[data-composer-input="true"][contenteditable="true"]').waitFor();
  gui.check('v11OwnedContactUIForkRetainsVerifiedFullNativePrefixAndBotIdentity',true);
  const input=gui.page.locator('[data-composer-input="true"][contenteditable="true"]');
  await input.fill('V11_GUI_FORK_MODEL：使用接续会话所选模型给出简短回复。');
  await input.press('Enter');
  await waitFor(()=>gui.report.requests.some(row=>row.sessionId===forked.value.sessionId&&row.purpose==='conversation'&&row.finish==='stop'),'real UI seeded fork native reply');
  const request=gui.report.requests.find(row=>row.sessionId===forked.value.sessionId&&row.purpose==='conversation');
  assert.equal(request.model,'model-b');
  assert.equal(request.provider,controlledProvider);
  assert.deepEqual((await service.adapter.readNative(contactId)).events,history.events);
  assert.equal(gui.contactId,contactId);
  assert.deepEqual(gui.app.ctx.agentDefaultModel.currentSelection(),defaults);
  gui.check('v11SeededForkUIChatUsesItsOwnNativeModelAndLeavesOriginalContactIntact',true);
}

async function memoryAndMaterials(gui, botId) {
  const count=gui.report.requests.length;
  await gui.workbench('记忆');
  await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(botId);
  const text='V11_PINNED_MEMORY：每次发布都核对原生身份 🧭',edited=`${text}，并保留真实来源。`;
  const editor=v11Card(gui,'添加记忆');
  await editor.getByLabel('内容',{exact:true}).fill(text);
  await editor.getByLabel('分类',{exact:true}).selectOption('decision');
  await editor.getByLabel('固定重要记忆（每 Bot 最多 8 条）').check();
  const saved=await uiRpc(gui,'memory.write',()=>button(editor,'保存到所选 Bot').click());
  receipt(gui,saved);
  const memoryId=saved.value.memoryId, originalSource=saved.value.source;
  assert.equal(saved.value.pinned,true);
  assert.equal(saved.value.botId,botId);
  await gui.until(s=>s.memories.some(row=>row.memoryId===memoryId&&row.pinned),'pinned GUI memory');
  await button(article(v11Card(gui,'长期记忆'),text),'编辑记忆').click();
  const editing=v11Card(gui,'编辑记忆');
  await editing.getByLabel('内容',{exact:true}).fill(edited);
  const changed=await uiRpc(gui,'memory.write',()=>button(editing,'保存记忆修改').click());
  receipt(gui,changed);
  assert.equal(changed.request.input.expectedVersion,saved.value.version);
  assert.equal(changed.value.memoryId,memoryId);
  assert.equal(changed.value.version,saved.value.version+1);
  assert.deepEqual(changed.value.source,originalSource);
  assert.equal(changed.value.text,edited);
  gui.check('v11PinnedMemoryEditPreservesIdentitySourceAndCAS',true);
  const memoryRow=article(v11Card(gui,'长期记忆'),edited);
  const unpinned=await uiRpc(gui,'memory.pin',()=>button(memoryRow,'取消固定').click());
  receipt(gui,unpinned);
  assert.equal(unpinned.value.memoryId,memoryId);
  assert.equal(unpinned.value.pinned,false);
  const repinned=await uiRpc(gui,'memory.pin',()=>button(memoryRow,'固定').click());
  receipt(gui,repinned);
  assert.equal(repinned.request.input.expectedVersion,unpinned.value.version);
  assert.equal(repinned.value.pinned,true);
  assert.equal(repinned.value.memoryId,memoryId);
  assert.deepEqual(repinned.value.source,originalSource);
  gui.check('v11MemoryPinToggleUsesTheSameEditedRecordAndCAS',true);

  const transfer=details(gui.page,'导入导出');
  await gui.expand(v11Card(gui,'长期记忆'),'导入导出');
  await transfer.getByLabel('导出条目（可多选；留空导出全部，最多 500 条）').selectOption(memoryId);
  const downloadPromise=gui.page.waitForEvent('download');
  const exported=await uiRpc(gui,'memory.export',()=>button(transfer,'导出记忆 JSON').click());
  const downloaded=await downloadPromise,downloadPath=join(gui.root,'work/v11-memory-export.json');
  await downloaded.saveAs(downloadPath);
  const fileText=await readFile(downloadPath,'utf8'),file=JSON.parse(fileText);
  assert.equal(fileText,exported.value.fileText);
  assert.equal(file.format,'dsh-bot-memory');
  assert.equal(file.entries.length,1);
  assert.equal(file.entries[0].text,edited);
  assert.equal(file.entries[0].pinned,true);
  assert.equal(file.entries[0].category,'decision');
  // Import the real export into a different Bot. Human provenance stays usable.
  const target=gui.botIds.find(id=>id!==botId);
  await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(target);
  await gui.expand(v11Card(gui,'长期记忆'),'导入导出');
  const preview=await uiRpc(gui,'memory.import.preview',()=>details(gui.page,'导入导出').getByLabel('导入 JSON 文件').setInputFiles(downloadPath));
  assert.equal(preview.request.input.fileDigest,hash(fileText));
  assert.equal(preview.value.entries.length,1);
  assert.equal(preview.value.entries[0].decision,'append');
  const imported=await uiRpc(gui,'memory.import',()=>button(details(gui.page,'导入导出'),'确认整批追加').click());
  receipt(gui,imported);
  assert.equal(imported.request.input.fileText,fileText);
  assert.equal(imported.request.input.fileDigest,hash(fileText));
  assert.equal(imported.request.input.expectedMemoryRevision,preview.value.memoryRevision);
  assert.equal(imported.value.addedIds.length,1);
  const targetMemory=gui.app.ctx.dshBot.store.read().memories[imported.value.addedIds[0]];
  assert.ok(targetMemory);
  assert.equal(targetMemory.botId,target);
  assert.equal(targetMemory.text,edited);
  assert.notEqual(targetMemory.memoryId,memoryId);
  assert.equal(targetMemory.pinned,true);
  assert.equal(targetMemory.inactive,false);
  assert.equal(targetMemory.source.operationId,imported.request.operationId);
  // Browsers do not emit change when selecting the same file again.
  await details(gui.page,'导入导出').getByLabel('导入 JSON 文件').setInputFiles([]);
  const duplicate=await uiRpc(gui,'memory.import.preview',()=>details(gui.page,'导入导出').getByLabel('导入 JSON 文件').setInputFiles(downloadPath));
  assert.equal(duplicate.value.entries[0].decision,'skip');
  await button(details(gui.page,'导入导出'),'取消导入').click();
  gui.check('v11MemoryExportImportUsesActualDownloadDigestPreviewAndReceipt',true);

  await gui.page.getByLabel('所属 Bot',{exact:true}).selectOption(botId);
  await gui.expand(v11Card(gui,'长期记忆'),'上下文预览');
  const context=details(gui.page,'上下文预览');
  await context.getByLabel('当前话题关键词').fill('V11_PINNED_MEMORY');
  const contextReply=await uiRpc(gui,'memory.context.preview',()=>button(context,'查看上下文预览').click());
  assert.ok(contextReply.value.includedMemoryIds.includes(memoryId));
  assert.ok(contextReply.value.context.includes(edited));
  await context.getByText(edited,{exact:true}).waitFor();
  gui.check('v11ContextPreviewReturnsThePinnedEditedMemory',true);

  await button(gui.page,'资料').click();
  const materialText='# GUI 引用验收\r\n\r\n第一段记录 🧭 Unicode 边界。\r\n\r\n## CITATION_MARKER\r\n准确引用这段原文，保持行号与哈希。\r\n';
  const ingest=v11Card(gui,'收录资料');
  await ingest.getByLabel('UTF-8 文本或 Markdown 文件').setInputFiles({name:'v11-citations.md',mimeType:'text/markdown',buffer:Buffer.from(materialText)});
  // File decoding updates the draft and remounts its form. A title entered
  // before that real upload finishes would be replaced by the filename.
  await waitFor(async()=>await ingest.getByLabel('正文',{exact:true}).inputValue()===materialText.replace(/\r\n?/g,'\n')&&
    await ingest.getByLabel('资料标题',{exact:true}).inputValue()==='v11-citations.md','uploaded source and filename are rendered before editing its title');
  await ingest.getByLabel('资料标题').fill('V11_GUI_MATERIAL');
  const material=await uiRpc(gui,'material.ingest',()=>button(ingest,'保存不可变资料').click());
  receipt(gui,material);
  assert.equal(material.value.title,'V11_GUI_MATERIAL');
  assert.equal(material.value.text,materialText);
  assert.equal(material.value.contentHash,hash(materialText));
  assert.equal(material.value.fileName,'v11-citations.md');
  const search=v11Card(gui,'资料检索');
  await search.getByLabel('关键词',{exact:true}).fill('CITATION_MARKER');
  const hits=await uiRpc(gui,'material.search',()=>button(search,'搜索资料').click());
  const hit=hits.value.find(row=>row.docId===material.value.docId);
  assert.ok(hit);
  assert.equal(hit.title,'V11_GUI_MATERIAL');
  const chunk=material.value.chunks.find(row=>row.chunkId===hit.chunkId);
  assert.ok(chunk);
  assert.equal(hit.excerpt,materialText.slice(chunk.startOffset,chunk.endOffset));
  assert.equal(hit.contentHash,hash(materialText));
  assert.equal(hit.startLine,5);
  assert.equal(hit.endLine,6);
  const page=await uiRpc(gui,'material.page',()=>button(article(search,'V11_GUI_MATERIAL'),'打开此引用').click());
  assert.equal(page.request.input.chunkId,hit.chunkId);
  assert.equal(page.value.text,hit.excerpt);
  assert.equal(page.value.startOffset,chunk.startOffset);
  assert.equal(page.value.endOffset,chunk.endOffset);
  assert.equal(page.value.contentHash,hit.contentHash);
  const reader=v11Card(gui,'V11_GUI_MATERIAL');
  await waitFor(async()=>await reader.locator('pre').textContent()===hit.excerpt,'rendered exact citation');
  gui.check('v11MaterialUploadSearchAndCitationUseExactUnicodeRangesLinesAndHash',true);
  await button(reader,'关闭正文').click();

  // The native log is read only to select a real fixture, then ingested by UI.
  const native=(await gui.original(gui.contactId)).find(event=>event.type==='assistant/message'&&event.data?.message?.content?.some(part=>part.type==='text'&&part.text));
  assert.ok(native,'Existing stock contact must have a real native reply');
  const partIndex=native.data.message.content.findIndex(part=>part.type==='text'&&part.text),nativeText=native.data.message.content[partIndex].text;
  await gui.expand(ingest,'从原生会话摘录');
  const excerpt=details(ingest,'从原生会话摘录');
  await excerpt.getByLabel('标题',{exact:true}).fill('V11_NATIVE_SOURCE');
  await excerpt.getByLabel('来源会话').selectOption(gui.contactId);
  await excerpt.getByLabel('事件序号').fill(String(native.seq));
  await excerpt.getByLabel('文本部分序号').fill(String(partIndex));
  await excerpt.getByLabel('文本开始位置').fill('0');
  await excerpt.getByLabel('文本结束位置').fill(String(nativeText.length));
  const sourced=await uiRpc(gui,'material.ingest',()=>button(excerpt,'收录真实会话片段').click());
  receipt(gui,sourced);
  assert.equal(sourced.value.text,nativeText);
  assert.equal(sourced.value.source.eventSeq,native.seq);
  assert.equal(sourced.value.source.sessionId,gui.contactId);
  await button(search,'显示全部资料').click();
  const sourcePage=await uiRpc(gui,'material.page',()=>button(article(search,'V11_NATIVE_SOURCE'),'打开正文').click());
  assert.equal(sourcePage.value.source.status,'verified');
  assert.equal(sourcePage.value.text,nativeText);
  await button(v11Card(gui,'V11_NATIVE_SOURCE'),'打开已核对的原生来源').click();
  await gui.page.locator('[data-composer-input="true"][contenteditable="true"]').waitFor();
  gui.check('v11MaterialNativeSourceIsVerifiedAndOpensTheOriginalContact',true);
  assert.equal(gui.report.requests.length,count);
  gui.check('v11KnowledgeMemoryAndContextIssueNoModelRequests',true);
  return {memoryId,edited};
}

async function createTask(gui,botId,title,dependsOn=[]) {
  await gui.workbench('任务');
  const card=v11Card(gui,'新任务');
  await card.getByLabel('负责人',{exact:true}).selectOption(botId);
  await card.getByLabel('标题',{exact:true}).fill(title);
  await card.getByLabel('目标',{exact:true}).fill(`GUI_SHORT ${title}：只输出实际验收结果`);
  await gui.expand(card,'验收与结果接收');
  await card.getByLabel('前置任务（可多选）',{exact:true}).selectOption(dependsOn);
  await card.getByLabel('验收条件（每行一项）',{exact:true}).fill('实际原生结果存在且资源已结算');
  await card.locator('select[name="origin"]').selectOption(gui.contactId);
  const rpc=await uiRpc(gui,'task.create',()=>button(card,'登记任务').click());
  receipt(gui,rpc);
  await gui.until(s=>s.tasks.some(row=>row.taskId===rpc.value.taskId),'v11 task creation');
  return rpc.value;
}

async function finishTask(gui,task) {
  const started=await uiRpc(gui,'task.start',()=>button(v11Card(gui,task.title),'开始／接续').click());
  receipt(gui,started);
  const snapshot=await gui.until(s=>s.tasks.find(row=>row.taskId===task.taskId)?.currentAttemptId===started.value.attemptId&&
    s.attempts.some(row=>row.attemptId===started.value.attemptId&&row.result&&!row.reservationHeld)&&
    s.outbox.some(row=>row.attemptId===started.value.attemptId&&row.state==='accepted'),'v11 exact newly started native attempt result and delivery');
  const current=snapshot.tasks.find(row=>row.taskId===task.taskId),attempt=snapshot.attempts.find(row=>row.attemptId===current.currentAttemptId);
  assert.ok(gui.report.requests.some(row=>row.sessionId===attempt.sessionId&&row.finish==='stop'));
  assert.ok((await gui.original(gui.contactId)).some(row=>row.type==='user/message'&&row.data.id===attempt.resultMessageId));
  await waitFor(()=>{
    const agent=gui.app.ctx.agents.get(gui.contactId);
    return gui.app.ctx.dshBot.adapter.resources(gui.contactId).settled&&
      (!agent||!agent.inbox.nextTurn.length&&!agent.inbox.nextStep.length);
  },'native result receiver finishes before read-only GUI checks');
  const resultText=attempt.result.content.map(part=>part.text??'').join('\n');
  assert.ok(resultText);
  // The polling UI can still show the running-version relationship draft even
  // after an independent snapshot observes native settlement. Wait for this
  // exact new attempt's result to be rendered before reloading that draft.
  await v11Card(gui,task.title).getByText(resultText,{exact:true}).waitFor();
  return attempt;
}

async function dependenciesAndHandoff(gui) {
  const upstream=await createTask(gui,gui.botIds[0],'V11_GUI_PREREQUISITE'),dependent=await createTask(gui,gui.botIds[0],'V11_GUI_DEPENDENT');
  const relations=details(v11Card(gui,dependent.title),'前置任务与责任交接');
  await gui.expand(v11Card(gui,dependent.title),'前置任务与责任交接');
  await relations.getByLabel('前置任务（可多选，全部有效验收后可开始）').selectOption(upstream.taskId);
  const linked=await uiRpc(gui,'task.dependencies.set',()=>button(relations,'保存前置任务').click());
  receipt(gui,linked);
  assert.deepEqual(linked.value.dependsOn,[upstream.taskId]);
  const before=gui.report.requests.length,attemptIds=Object.keys(gui.app.ctx.dshBot.store.read().attempts);
  await uiRpc(gui,'task.start',()=>button(v11Card(gui,dependent.title),'开始／接续').click(),{errorCode:'dependency_blocked'});
  assert.equal(gui.report.requests.length,before);
  assert.deepEqual(Object.keys(gui.app.ctx.dshBot.store.read().attempts),attemptIds);
  gui.check('v11TaskDependencyUIBlocksNativeAdmissionBeforeRealAcceptance',true);
  const first=await finishTask(gui,upstream);
  await gui.expand(v11Card(gui,upstream.title),'验收结果');
  const acceptance=details(v11Card(gui,upstream.title),'验收结果');
  await acceptance.getByLabel('结论').selectOption('passed');
  await acceptance.getByLabel('实际证据').fill(`Native attempt ${first.attemptId}, accepted message ${first.resultMessageId}; native resources settled.`);
  const accepted=await uiRpc(gui,'task.accept',()=>button(acceptance,'记录验收').click());
  receipt(gui,accepted);
  assert.equal(accepted.value.acceptance,'passed');
  assert.equal(accepted.value.acceptanceEvidence.attemptId,first.attemptId);

  // Settle one real execution before handoff, proving the old attempt keeps owner.
  const second=await finishTask(gui,dependent);
  assert.equal(second.prerequisiteInputs[0].attemptId,first.attemptId);
  assert.equal(second.prerequisiteInputs[0].acceptanceEvidence.attemptId,first.attemptId);
  assert.ok(gui.app.ctx.dshBot.store.read().taskInputs[second.prerequisiteInputs[0].inputId]);
  const own=gui.botIds[0],target=gui.botIds[1];
  await gui.expand(v11Card(gui,dependent.title),'前置任务与责任交接');
  const liveRelations=details(v11Card(gui,dependent.title),'前置任务与责任交接');
  // The real component explicitly reloads the relationship draft after execution.
  await button(liveRelations,'重新载入任务关系').waitFor();
  await button(liveRelations,'重新载入任务关系').click();
  await liveRelations.getByLabel('接手 Bot').selectOption(target);
  await liveRelations.getByLabel('交接说明').fill('V11_GUI_HANDOFF：结算后接手，保留原运行身份。');
  const handed=await uiRpc(gui,'task.handoff',()=>button(liveRelations,'确认交给所选 Bot').click());
  receipt(gui,handed);
  const state=gui.app.ctx.dshBot.store.read();
  assert.equal(state.tasks[dependent.taskId].botId,target);
  assert.equal(state.attempts[second.attemptId].botId,own);
  assert.equal(state.tasks[dependent.taskId].handoffs.at(-1).previousAttemptId,second.attemptId);
  assert.equal(state.tasks[dependent.taskId].handoffs.at(-1).operationId,handed.request.operationId);
  const resumed=await finishTask(gui,dependent);
  assert.notEqual(resumed.attemptId,second.attemptId);
  assert.equal(resumed.botId,target);
  assert.equal(resumed.prerequisiteInputs[0].attemptId,first.attemptId);
  gui.check('v11AcceptedDependencyNativeInputAndSettledHandoffPreserveAttemptIdentities',true);
  return upstream;
}

async function templates(gui) {
  const count=gui.report.requests.length;
  await gui.workbench('内部群');
  await gui.expand(gui.page,'从团队模板创建');
  const template=details(gui.page,'从团队模板创建');
  await template.getByLabel('模板',{exact:true}).selectOption('development-testing');
  if(await button(template,'按最新工作台重新准备模板').count())await button(template,'按最新工作台重新准备模板').click();
  await template.locator('[name="developer.name"]').fill('V11_GUI_TEMPLATE_DEV');
  await template.locator('[name="tester.name"]').fill('V11_GUI_TEMPLATE_QA');
  for(const role of ['developer','tester'])await template.locator(`[name="${role}.model"]`).selectOption(JSON.stringify({provider:controlledProvider,model:'model-a'}));
  await template.getByLabel('内部群名称').fill('V11_GUI_TEMPLATE_TEAM');
  const before=gui.app.ctx.dshBot.store.read();
  const created=await uiRpc(gui,'template.instantiate',()=>button(template,'创建团队与内部群').click());
  receipt(gui,created);
  const after=gui.app.ctx.dshBot.store.read(),ids=Object.values(created.value.botIdsByRole);
  assert.equal(created.request.expectedRevision,before.revision);
  assert.equal(after.revision,before.revision+1);
  assert.equal(Object.keys(after.bots).length,Object.keys(before.bots).length+2);
  assert.equal(Object.keys(after.groups).length,Object.keys(before.groups).length+1);
  assert.equal(new Set(ids).size,2);
  assert.deepEqual(new Set(after.groups[created.value.groupId].members.filter(row=>row.active).map(row=>row.botId)),new Set(ids));
  assert.equal(after.groups[created.value.groupId].name,'V11_GUI_TEMPLATE_TEAM');
  for(const id of ids)assert.ok(!Object.values(after.sessions).some(row=>row.botId===id));
  await gui.page.getByRole('heading',{name:'V11_GUI_TEMPLATE_TEAM',exact:true}).waitFor();
  assert.equal(gui.report.requests.length,count);
  gui.check('v11TeamTemplateCreatesTwoBotsAndGroupInOneReceiptWithoutConversation',true);
}

async function schedules(gui) {
  const count=gui.report.requests.length;
  await gui.workbench('任务');
  await gui.expand(v11Card(gui,'新任务'),'提醒与定时');
  const pane=details(v11Card(gui,'新任务'),'提醒与定时');
  const editor=pane.locator('form').filter({has:button(gui.page,'确认创建安排')});
  await editor.getByLabel('负责 Bot').selectOption(gui.botIds[0]);
  await editor.getByLabel('安排类型').selectOption('reminder');
  await editor.getByLabel('提醒内容').fill('V11_GUI_REMINDER_PENDING');
  await editor.getByLabel('频率').selectOption('interval');
  await editor.getByLabel('时区',{exact:true}).fill('UTC');
  await editor.getByLabel('首次时间（带时区，例如 2026-10-10T09:00:00+08:00）').fill(new Date(Date.now()+3600000).toISOString());
  await editor.getByLabel('间隔分钟（至少 15）').fill('15');
  const created=await uiRpc(gui,'schedule.create',()=>button(editor,'确认创建安排').click());
  receipt(gui,created);
  const id=created.value.scheduleId;
  await gui.until(s=>s.schedules.some(row=>row.scheduleId===id),'GUI schedule creation');
  const row=article(pane,'V11_GUI_REMINDER_PENDING');
  const paused=await uiRpc(gui,'schedule.state',()=>button(row,'暂停安排').click());
  receipt(gui,paused);
  assert.equal(paused.value.enabled,false);
  assert.equal(paused.value.scheduleId,id);
  await button(row,'编辑并重新确认').click();
  if(await button(pane,'重新载入最新安排').count())await button(pane,'重新载入最新安排').click();
  const edit=pane.locator('form').filter({has:button(gui.page,'重新确认并保存安排')});
  await edit.getByLabel('提醒内容').fill('V11_GUI_REMINDER_DELIVERED');
  const due=new Date(Date.now()+8000).toISOString();
  await edit.getByLabel('首次时间（带时区，例如 2026-10-10T09:00:00+08:00）').fill(due);
  await edit.getByLabel('启用安排',{exact:true}).check();
  const updated=await uiRpc(gui,'schedule.update',()=>button(edit,'重新确认并保存安排').click());
  receipt(gui,updated);
  assert.equal(updated.request.input.expectedVersion,paused.value.version);
  assert.equal(updated.value.scheduleId,id);
  assert.equal(updated.value.nextDueAt,due);
  assert.equal(updated.value.enabled,true);
  const state=await gui.until(s=>s.notices.some(n=>n.scheduleId===id&&n.message==='V11_GUI_REMINDER_DELIVERED'),'actual native timer reminder');
  const notice=state.notices.find(n=>n.scheduleId===id),store=gui.app.ctx.dshBot.store.read(),occurrence=store.occurrences[notice.occurrenceId];
  assert.equal(notice.dueAt,due);
  assert.equal(notice.read,false);
  assert.equal(occurrence.scheduleId,id);
  assert.equal(occurrence.state,'settled');
  assert.equal(occurrence.taskId,undefined);
  assert.equal(gui.report.requests.length,count);
  const noticeCard=article(pane,'V11_GUI_REMINDER_DELIVERED').filter({has:button(gui.page,'确认已读')});
  const ack=await uiRpc(gui,'notice.ack',()=>button(noticeCard,'确认已读').click());
  receipt(gui,ack);
  assert.equal(ack.value.noticeId,notice.noticeId);
  assert.equal(ack.value.read,true);
  gui.check('v11ScheduleCreatePauseEditRealReminderAndReadUseOriginalIdentities',true);
  const scheduleCard=article(pane,'V11_GUI_REMINDER_DELIVERED').filter({has:button(gui.page,'编辑并重新确认')});
  const archived=await uiRpc(gui,'schedule.state',()=>button(scheduleCard,'归档安排').click());
  receipt(gui,archived);
  assert.equal(archived.value.enabled,false);
  assert.equal(archived.value.archived,true);
  await gui.expand(scheduleCard,'触发历史');
  const history=details(scheduleCard,'触发历史');
  await history.getByLabel('选择清理此已结算触发记录').check();
  await button(history,'清理所选历史').click();
  assert.ok(gui.app.ctx.dshBot.store.read().occurrences[occurrence.occurrenceId]);
  const cleaned=await uiRpc(gui,'occurrence.prune',()=>button(history,'确认清理所选记录').click());
  receipt(gui,cleaned);
  assert.deepEqual(cleaned.request.input.occurrenceIds,[occurrence.occurrenceId]);
  assert.equal(cleaned.request.input.confirm,true);
  assert.equal(gui.app.ctx.dshBot.store.read().occurrences[occurrence.occurrenceId],undefined);
  assert.equal(gui.app.ctx.dshBot.store.read().notices[notice.noticeId].read,true);
  assert.ok(gui.app.ctx.dshBot.store.read().operations[created.request.operationId]);
  assert.equal(gui.report.requests.length,count);
  gui.check('v11ScheduleArchiveAndExplicitConfirmedHistoryCleanupRetainReceipts',true);
}

async function briefingAndDiagnostics(gui,task) {
  const count=gui.report.requests.length;
  await gui.workbench('会话管理');
  await button(gui.page,'刷新会话').click();
  await button(gui.page.locator('article').filter({hasText:gui.contactId}),'查看原生会话').click();
  await gui.page.locator('[data-composer-input="true"][contenteditable="true"]').waitFor();
  const briefing=await uiRpc(gui,'briefing',()=>gui.page.getByRole('banner').getByRole('button',{name:/^任务简报/}).click());
  const dialog=gui.page.getByRole('dialog',{name:'任务简报',exact:true});
  assert.equal(briefing.request.input.botId,gui.botIds[0]);
  const result=briefing.value.tasks.find(row=>row.taskId===task.taskId);
  assert.ok(result);
  assert.ok(result.previews.some(row=>row.kind==='result'&&row.text));
  const row=article(dialog,task.title).filter({has:button(gui.page,'打开工作台任务')});
  for(const preview of result.previews)await row.getByText(preview.text,{exact:true}).waitFor();
  await button(row,'打开工作台任务').click();
  await v11Card(gui,task.title).waitFor();
  assert.equal(await dialog.count(),0);
  assert.equal(gui.report.requests.length,count);
  gui.check('v11BriefingShowsRealResultAndNavigatesToItsTaskWithoutReplay',true);
  await gui.workbench('结果与投递');
  await gui.expand(gui.page,'诊断');
  const diagnostic=details(gui.page,'诊断');
  const reply=await uiRpc(gui,'diagnostics.read',()=>button(diagnostic,'预览诊断').click());
  await diagnostic.locator('pre').waitFor();
  const rendered=await diagnostic.locator('pre').innerText(),value=JSON.parse(rendered);
  assert.deepEqual(value,reply.value);
  assert.equal(value.versions.plugin,manifest.version);
  assert.equal(value.versions.protocol,2);
  assert.equal(value.counts.materials,Object.keys(gui.app.ctx.dshBot.store.read().materials).length);
  assert.equal(value.counts.schedules,Object.keys(gui.app.ctx.dshBot.store.read().schedules).length);
  assert.deepEqual(Object.keys(value).sort(),['counts','features','operationIds','profileId','versions']);
  assert.ok(!rendered.includes(gui.root));
  assert.ok(!rendered.includes('V11_GUI_REMINDER_DELIVERED'));
  assert.equal(gui.report.requests.length,count);
  gui.check('v11DiagnosticsPreviewRendersActualAllowlistedResponseWithoutModelOrBody',true);
}

/** Added to the existing stock suite; all writes originate from real UI controls. */
export async function runV11UiChecks(gui) {
  const state=await gui.snapshot();
  assert.equal(state.pluginVersion,manifest.version);
  assert.equal(state.clientProtocol,2);
  assert.equal(gui.app.ctx.dshBot.store.read().schema,2);
  const originalChecks=Object.keys(gui.report.checks).length;
  gui.report.v11Ui={realBrowser:true,apiWritesForV11Workflows:0,realTimer:true,originalChecksBeforeV11:originalChecks};
  const stage=name=>{gui.report.v11Ui.stage=name;console.log(JSON.stringify({v11Stage:name}));};
  stage('memory-materials-and-context');
  await memoryAndMaterials(gui,gui.botIds[0]);
  // The template editor deliberately freezes its starting store revision.
  // Prepare it in the quiescent knowledge phase before native task/result
  // delivery adds asynchronous receipts and notices to the store.
  stage('atomic-team-template');
  await templates(gui);
  stage('task-dependencies-and-handoff');
  const task=await dependenciesAndHandoff(gui);
  stage('real-timer-reminder-and-explicit-cleanup');
  await schedules(gui);
  stage('briefing-and-diagnostics');
  await briefingAndDiagnostics(gui,task);
  stage('owned-session-configure-and-seeded-fork');
  await ownSessionControls(gui);
  gui.check('v11UiNoExternalModelRequests',gui.report.realModelRequests===0);
  gui.report.v11Ui.checksAdded=Object.keys(gui.report.checks).length-originalChecks;
  await gui.save('v11-native-workbench');
}
