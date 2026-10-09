import manifest from '../../package.json' with {type:'json'};
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {taskFixture} from './task-fixture.mjs';
import {BotService} from '../../src/native/service.mjs';
import {eventually} from './official-fixture.mjs';

async function upgraded(t) {
  const f=await taskFixture(t);
  const {KnowledgeController}=await import('../../src/native/knowledge.mjs');
  const {MemoryController}=await import('../../src/native/memory.mjs');
  const knowledge=new KnowledgeController(f),memory=new MemoryController({...f,knowledge});
  const service=new BotService({...f,knowledge,memory});f.adapter.setService(service);
  return {...f,knowledge,memory,service};
}
test('authenticated service routes immutable material citations without placing bodies in snapshots',async t=>{
  const f=await upgraded(t),bot=await f.bot('service-knowledge');
  const record=await f.service.dispatch(f.human,{action:'material.ingest',operationId:randomUUID(),input:{botId:bot.botId,title:'项目资料',text:'# 协作\n机器人分别保存记忆。'}});
  const matches=await f.service.dispatch(f.human,{action:'material.search',input:{query:'分别保存'}});
  assert.equal(matches[0].docId,record.docId);
  const page=await f.service.dispatch(f.human,{action:'material.page',input:{docId:record.docId,chunkId:matches[0].chunkId}});
  assert.equal(page.text,matches[0].excerpt);
  const snapshot=f.service.snapshot(f.human);
  assert.equal(snapshot.pluginVersion,manifest.version);assert.equal(snapshot.clientProtocol,2);
  assert.equal(snapshot.materials[0].docId,record.docId);
  assert.equal(Object.hasOwn(snapshot.materials[0],'text'),false);
  assert.equal(Object.hasOwn(snapshot.materials[0],'chunks'),false);
  assert.equal(f.requests.length,0);
});
test('service preserves memory identity on edit and binds export/import to exact original file',async t=>{
  const f=await upgraded(t),bot=await f.bot('service-memory');
  const first=await f.service.dispatch(f.human,{action:'memory.write',operationId:randomUUID(),input:{botId:bot.botId,text:'喜欢中文',category:'preference'}});
  const edited=await f.service.dispatch(f.human,{action:'memory.write',operationId:randomUUID(),input:{botId:bot.botId,memoryId:first.memoryId,expectedVersion:first.version,text:'偏好中文说明',category:'preference',pinned:true}});
  assert.equal(edited.memoryId,first.memoryId);assert.deepEqual(edited.source,first.source);
  const file=await f.service.dispatch(f.human,{action:'memory.export',input:{botId:bot.botId}}),target=await f.bot('service-memory-target');
  const preview=await f.service.dispatch(f.human,{action:'memory.import.preview',input:{botId:target.botId,fileText:file.fileText,fileDigest:file.fileDigest}});
  const imported=await f.service.dispatch(f.human,{action:'memory.import',operationId:randomUUID(),input:{botId:target.botId,fileText:file.fileText,fileDigest:file.fileDigest,expectedMemoryRevision:preview.memoryRevision}});
  assert.equal(imported.addedIds.length,1);assert.notEqual(imported.addedIds[0],first.memoryId);
  assert.equal(f.requests.length,0);
});
test('snapshot checks result and report origins independently instead of overwriting one artifact ACL',async t=>{
  const f=await taskFixture(t),a=await f.bot('artifact-owner'),b=await f.bot('artifact-source');
  const contact=await f.sessions.create(f.human,{action:'session.create',operationId:randomUUID(),input:{botId:a.botId}}),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  const task=await f.task(a,'artifact-task');
  await f.store.transact({action:'test.artifacts',operationId:randomUUID(),input:{}},draft=>{
    draft.memories.secret={memoryId:'secret',botId:b.botId,text:'hidden source'};
    draft.bots[b.botId].share.enabled=false;
    draft.attempts.artifact={attemptId:'artifact',taskId:task.taskId,botId:a.botId,sessionId:contact.sessionId,epoch:1,result:{content:[{type:'text',text:'private result'}],origins:[{kind:'memory',id:'secret'}]},report:{text:'plain report',origins:[]}};
    return null;
  });
  assert.equal(f.service.snapshot(actor).attempts.length,0);
});
test('production legacy BotDirectory entry points use source-preserving memory and complete bounded context',async t=>{
  const f=await upgraded(t),bot=await f.bot('compatibility-memory');
  f.bots.setMemoryController(f.memory);
  const first=await f.bots.memoryWrite(f.human,{action:'memory.write',operationId:randomUUID(),input:{botId:bot.botId,text:'原始事实'}});
  const edited=await f.bots.memoryWrite(f.human,{action:'memory.write',operationId:randomUUID(),input:{botId:bot.botId,memoryId:first.memoryId,expectedVersion:first.version,text:'修订事实',pinned:true}});
  assert.deepEqual(edited.source,first.source);assert.equal(edited.pinned,true);
  assert.equal(f.bots.searchMemory(f.human,{botId:bot.botId,pinned:true})[0].memoryId,first.memoryId);
  assert.equal(f.bots.context(f.human,{botId:bot.botId},{maxChars:12000}),f.memory.context(f.human,{botId:bot.botId},{maxChars:12000}));
  await f.bots.memoryForget(f.human,{action:'memory.forget',operationId:randomUUID(),input:{memoryId:first.memoryId,expectedVersion:edited.version}});
  assert.equal(f.bots.searchMemory(f.human,{botId:bot.botId}).length,0);
  assert.equal(f.requests.length,0);
});
test('service snapshot withholds nested fixed prerequisite bytes after original execution-source revocation',async t=>{
  const f=await taskFixture(t),a=await f.bot('upstream-owner'),b=await f.bot('consumer-owner'),upstream=await f.task(a,'snapshot-upstream');
  const original=await f.tasks.start(f.human,{action:'task.start',operationId:randomUUID(),input:{taskId:upstream.taskId,expectedVersion:1}});
  await eventually(()=>!f.store.read().attempts[original.attemptId].reservationHeld);
  await f.tasks.accept(f.human,{action:'task.accept',operationId:randomUUID(),input:{taskId:upstream.taskId,expectedVersion:f.store.read().tasks[upstream.taskId].version,attemptId:original.attemptId,outcome:'passed',evidence:'真实原始结果已核验'}});
  const contact=await f.sessions.create(f.human,{action:'session.create',operationId:randomUUID(),input:{botId:b.botId}}),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  const task=await f.tasks.create(f.human,{action:'task.create',operationId:randomUUID(),input:{botId:b.botId,title:'snapshot-consumer',goal:'消费固定上游结果',criteria:[],dependsOn:[upstream.taskId]}});
  const attempt=await f.tasks.start(f.human,{action:'task.start',operationId:randomUUID(),input:{taskId:task.taskId,expectedVersion:1}});
  await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
  assert.ok(f.service.snapshot(actor).attempts.some(row=>row.attemptId===attempt.attemptId&&row.prerequisiteInputs[0].result.content.length));
  await f.policy.authorizeShare(f.human,{action:'share.set',operationId:randomUUID(),input:{botId:a.botId,share:{enabled:true,receivers:['*'],scope:{tasks:['*'],sessions:[],memories:['*']}}}});
  const snapshot=f.service.snapshot(actor);
  assert.ok(snapshot.tasks.some(row=>row.taskId===task.taskId));
  assert.equal(snapshot.attempts.some(row=>row.attemptId===attempt.attemptId),false);
  assert.equal(f.service.snapshot(f.human).attempts.some(row=>row.attemptId===attempt.attemptId),true);
});
test('all published notice previews preserve independent artifact sources in later Bot-authored content',async t=>{
  for(const action of ['notice.list','snapshot','briefing'])await t.test(action,async t=>{
    const f=await upgraded(t),{AssistantController}=await import('../../src/native/assistant.mjs'),assistant=new AssistantController({...f,clock:{now:()=>Date.parse('2026-10-09T00:00:00Z')}});
    f.beforeClose.push(()=>assistant.close());f.service.assistant=assistant;
    const bot=await f.bot('notice-consumer'),foreign=await f.bot('notice-source');
    const contact=await f.sessions.create(f.human,{action:'session.create',operationId:randomUUID(),input:{botId:bot.botId}}),source=await f.sessions.create(f.human,{action:'session.create',operationId:randomUUID(),input:{botId:foreign.botId}});
    await f.store.transact({action:'test.notice',operationId:randomUUID(),input:{}},draft=>{
      draft.memories.foreign_notice={memoryId:'foreign_notice',botId:foreign.botId,text:'受控资料',origins:[],source:{kind:'human'}};
      draft.materials.foreign_doc={docId:'foreign_doc',botId:foreign.botId,title:'受控来源',origins:[],source:{kind:'human'}};
      const task={taskId:'notice_task',botId:bot.botId,title:'已归档的历史结果',state:'awaiting_acceptance',version:1,archived:true,currentAttemptId:'notice_attempt',origins:[],source:{kind:'human'}};
      const attempt={attemptId:'notice_attempt',taskId:task.taskId,botId:bot.botId,sessionId:contact.sessionId,epoch:1,state:'returned',resultOutboxId:'notice_outbox',result:{content:[{type:'text',text:'受控资料'}],source:{kind:'session',sessionId:source.sessionId},contentSources:[{kind:'material',docId:'foreign_doc'}],origins:[{kind:'memory',id:'foreign_notice'}]}};
      const row={kind:'result',taskId:task.taskId,attemptId:attempt.attemptId,epoch:1,outboxId:'notice_outbox',sessionId:contact.sessionId};
      draft.tasks[task.taskId]=task;draft.attempts[attempt.attemptId]=attempt;draft.outbox[row.outboxId]=row;assistant.recordResultNoticeInDraft(draft,task,attempt,row);return null;
    });
    const actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId)),response=await f.service.dispatch(actor,{action,input:{}}),notices=action==='notice.list'?response:response.notices;
    assert.equal(notices[0].previews[0].text,'受控资料');
    const deps=f.policy.readDependencies(actor);
    for(const reference of [{kind:'memory',id:'foreign_notice'},{kind:'material',id:'foreign_doc'},{kind:'session',id:source.sessionId}])assert.ok(deps.some(row=>row.kind===reference.kind&&row.id===reference.id),`lost ${reference.kind} source`);
    const reminder=await assistant.createSchedule(actor,{action:'schedule.create',operationId:randomUUID(),input:{ownerBotId:bot.botId,kind:'reminder',message:notices[0].previews[0].text,rule:{kind:'once',timezone:'UTC',date:'2026-10-09',time:'00:03'}}});
    await f.policy.authorizeShare(f.human,{action:'share.set',operationId:randomUUID(),input:{botId:foreign.botId,share:{enabled:false,receivers:['*'],scope:{tasks:['*'],sessions:['*'],memories:['*'],materials:['*']}}}});
    assert.equal(f.policy.canRead(actor,{kind:'schedule',id:reminder.scheduleId}),false);
    await assert.rejects(f.service.dispatch(actor,{action:'memory.write',operationId:randomUUID(),input:{botId:bot.botId,text:notices[0].previews[0].text}}),{code:'access_denied'});
    assert.equal(f.requests.length,0);
  });
});
test('RPC unknown failures retain safe error identity without disclosing native exception contents',async()=>{
  const {mountBotRoutes}=await import('../../src/native/api.mjs'),routes=new Map();
  let errorCode;
  const dispose=await mountBotRoutes({connection:{operator:{},fetch:{register(route){routes.set(route.path,route);return()=>routes.delete(route.path);}}}},{policy:{fromPeer:()=>({kind:'human'})},service:{dispatch(){throw Object.assign(new Error('private-token /private/native/path'),{code:errorCode});}},isClosed:()=>false});
  try {
    for(const code of [undefined,'request_failed','agent-preset/locked','agent-preset/not-found','agent-preset/invalid']) {
    errorCode=code;
    const response=await routes.get('/api/dsh.bot/command').fetch(new Request('http://localhost/api/dsh.bot/command',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'retained-id',method:'dsh.bot/command',payload:{action:'snapshot',input:{}}})}));
    const body=await response.json();assert.equal(body.rpcId,'retained-id');assert.equal(body.result.error.code,code??'internal_error');
    assert.equal(JSON.stringify(body).includes('private-token'),false);assert.equal(JSON.stringify(body).includes('/private/native/path'),false);
    }
  }finally{await dispose();}
});
