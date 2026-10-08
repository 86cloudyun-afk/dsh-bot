import test from 'node:test';
import assert from 'node:assert/strict';
import {installModelSelection} from '@deepseek-ai/dsh-agent';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {businessFixture} from './business-fixture.mjs';
import {BotService} from '../../src/native/service.mjs';
import {deferred,eventually} from './official-fixture.mjs';
async function fixture(t){const f=await businessFixture(t);f.service=new BotService(f);f.adapter.setService(f.service);return f;}
const message=text=>createUserMessage({content:[{type:'text',text}],source:{kind:'native-regression'}});
async function revoke(f,botId){return f.policy.authorizeShare(f.human,{operationId:'revoke',action:'share.set',input:{botId,share:{enabled:false,receivers:['*'],scope:{sessions:['*'],tasks:['*'],memories:['*']}}}});}

test('review: native UI selection conflict is explicit before any changed-model request',async t=>{
  const f=await fixture(t),bot=await f.bot(),binding=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:bot.botId}}),agent=f.ctx.agents.get(binding.sessionId);
  t.after(installModelSelection(agent.ctx,{current:{provider:'controlled',model:'model-b'}}));
  agent.session.append('model/selection',{provider:'controlled',model:'model-b'});agent.followup(message('One reply.'));
  await eventually(()=>f.events.get(agent.id)?.some(event=>event.type==='turn/end'));
  assert.equal(f.requests.length,0);assert.match(JSON.stringify(f.events.get(agent.id)),/model_drift/);
});
test('review: revoked tool publication exposes neither plaintext content nor canonical value',async t=>{
  const f=await fixture(t),a=await f.bot('A'),b=await f.bot('B');await f.bots.memoryWrite(f.human,{operationId:'fact',action:'memory.write',input:{botId:b.botId,text:'REVOKED_PUBLICATION_MARKER'}});
  const binding=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:a.botId}}),agent=f.ctx.agents.get(binding.sessionId),entered=deferred(),release=deferred();
  t.after(()=>release.resolve());t.after(agent.ctx.on('tools/post-execute',async(_exec,_result,next)=>{entered.resolve();await release.promise;return next();}));
  const pending=f.ctx.tools.execute({callId:'read',name:'dsh_bot',agent,signal:new AbortController().signal,arguments:{action:'memory.search',input:{botId:b.botId}}});
  await entered.promise;await revoke(f,b.botId);release.resolve();const result=await pending;
  assert.equal(JSON.stringify(result).includes('REVOKED_PUBLICATION_MARKER'),false);assert.match(JSON.stringify(result.content),/拒绝/);
});

test('review: PTC receives an opaque receipt without forwarding a revoked read value',async t=>{
  const f=await fixture(t),a=await f.bots.create(f.human,{operationId:'a',action:'bot.create',input:{name:'A',cwd:f.dir,contact:{provider:'controlled',model:'model-a'},capabilities:['run_code']}}),b=await f.bot('B');
  await f.bots.memoryWrite(f.human,{operationId:'fact',action:'memory.write',input:{botId:b.botId,text:'PTC_PUBLICATION_MARKER'}});
  const binding=await f.sessions.create(f.human,{operationId:'channel',action:'session.create',input:{botId:a.botId}}),agent=f.ctx.agents.get(binding.sessionId),entered=deferred(),release=deferred();t.after(()=>release.resolve());
  t.after(f.ctx.provide('ptcRuntime',{language:'typescript',executionInstructions:'Controlled test executor.',resolve:request=>request,async run(spec){const receipt=await spec.bindings[0].functions.dsh_bot({action:'memory.search',input:{botId:b.botId}});return {logs:[],value:JSON.stringify(receipt)};}}));
  t.after(agent.ctx.tools.presentAs('both'));t.after(agent.ctx.on('tools/post-execute',async(exec,_result,next)=>{if(exec.name==='dsh_bot'){entered.resolve();await release.promise;}return next();}));
  const pending=f.ctx.tools.execute({callId:'ptc',name:'run_code',agent,signal:new AbortController().signal,arguments:{description:'One controlled read',code:'await tools.dsh_bot()'}});
  await entered.promise;await revoke(f,b.botId);release.resolve();assert.equal(JSON.stringify(await pending).includes('PTC_PUBLICATION_MARKER'),false);
});
test('review: explicit native memory sources remain revocable after deriving own memory',async t=>{
  const f=await fixture(t),a=await f.bot('A'),b=await f.bot('B'),own=await f.sessions.create(f.human,{operationId:'own',action:'session.create',input:{botId:a.botId}}),source=await f.sessions.create(f.human,{operationId:'source',action:'session.create',input:{botId:b.botId}}),agent=f.ctx.agents.get(source.sessionId);
  agent.followup(message('Source evidence.'));await eventually(()=>f.events.get(agent.id)?.some(event=>event.type==='turn/end'));await f.ctx.sessions.flush(agent.session);
  const actor=f.policy.fromAgent(f.ctx.agents.get(own.sessionId)),memory=await f.bots.memoryWrite(actor,{operationId:'derive',action:'memory.write',input:{botId:a.botId,text:'DERIVED_SOURCE_MARKER',source:{sessionId:source.sessionId,eventSeq:0}}});
  await revoke(f,b.botId);assert.equal(f.policy.canRead(actor,{kind:'memory',id:memory.memoryId}),false);assert.equal(f.bots.context(actor,own).includes('DERIVED_SOURCE_MARKER'),false);
});
test('review: sealed task summaries do not enter another conversation model context',async t=>{
  const f=await fixture(t),bot=await f.bot(),own=await f.sessions.create(f.human,{operationId:'own',action:'session.create',input:{botId:bot.botId}}),agent=f.ctx.agents.get(own.sessionId);
  await f.store.transact({operationId:'sealed',action:'seed',input:{}},draft=>{draft.meetings.m={meetingId:'m',epoch:1,phase:'independent'};draft.tasks.secret={taskId:'secret',botId:bot.botId,title:'SEALED_TASK_MARKER',state:'running',source:{sessionId:'independent',meetingId:'m',epoch:1,phase:'independent'}};return null;});
  agent.followup(message('One reply.'));await eventually(()=>f.events.get(agent.id)?.some(event=>event.type==='turn/end'));
  assert.equal(JSON.stringify(f.requests[0].messages).includes('SEALED_TASK_MARKER'),false);
});
test('review: listing foreign sessions records durable current read dependencies',async t=>{
  const f=await fixture(t),a=await f.bot('A'),b=await f.bot('B'),own=await f.sessions.create(f.human,{operationId:'own',action:'session.create',input:{botId:a.botId}}),foreign=await f.sessions.create(f.human,{operationId:'foreign',action:'session.create',input:{botId:b.botId}}),agent=f.ctx.agents.get(own.sessionId);
  await f.service.dispatch(f.policy.fromAgent(agent),{action:'session.list',input:{}});
  assert.ok(f.store.read().sessions[own.sessionId].origins?.some(ref=>ref.id===foreign.sessionId));
  await revoke(f,b.botId);agent.followup(message('One reply.'));await eventually(()=>f.events.get(agent.id)?.some(event=>event.type==='turn/end'));assert.equal(f.requests.length,0);
});
