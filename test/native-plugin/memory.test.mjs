import test from 'node:test';
import assert from 'node:assert/strict';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {businessFixture} from './business-fixture.mjs';
import {eventually} from './official-fixture.mjs';

async function setup(t) {
  const f=await businessFixture(t),bot=await f.bot('A'),other=await f.bot('B');
  assert.equal(typeof f.bots.memoryWrite,'function','durable BotMemory feature is missing');
  return {...f,bot,other};
}
test('a new native session includes its bot identity memory and unfinished tasks',async t=>{
  const f=await setup(t);
  await f.bots.memoryWrite(f.human,{operationId:'remember',action:'memory.write',input:{botId:f.bot.botId,memoryId:'preference',text:'用户喜欢中文和简洁回复'}});
  await f.bots.memoryWrite(f.human,{operationId:'foreign',action:'memory.write',input:{botId:f.other.botId,memoryId:'foreign-memory',text:'FOREIGN_PRIVATE_CONTEXT'}});
  await f.store.transact({operationId:'pending',action:'seed',input:{}},draft=>{draft.tasks.pending={taskId:'pending',botId:f.bot.botId,title:'稍后整理报告',state:'UNKNOWN'};return null;});
  const binding=await f.sessions.create(f.human,{operationId:'new-session',action:'session.create',input:{botId:f.bot.botId}}),agent=f.ctx.agents.get(binding.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'根据你记得的偏好回复。'}],source:{kind:'native-plugin-test'}}));
  await eventually(()=>f.events.get(binding.sessionId)?.some(e=>e.type==='turn/end'));
  const text=JSON.stringify(f.requests[0].messages);
  assert.ok(text.includes(f.bot.botId));assert.ok(text.includes('用户喜欢中文和简洁回复'));assert.ok(text.includes('稍后整理报告'));
  assert.equal(text.includes('FOREIGN_PRIVATE_CONTEXT'),false);
  await f.ctx.sessions.flush(agent.session);
  assert.ok(JSON.stringify((await f.adapter.readNative(binding.sessionId)).events).includes('用户喜欢中文和简洁回复'),'memory context is reconstructable from actual native log');
});
test('memory updates use explicit versions and concurrent changes never overwrite each other',async t=>{
  const f=await setup(t),memory=await f.bots.memoryWrite(f.human,{operationId:'create-memory',action:'memory.write',input:{botId:f.bot.botId,memoryId:'fact',text:'original'}});
  const results=await Promise.allSettled(['one','two'].map((text,index)=>f.bots.memoryWrite(f.human,{operationId:`update-${index}`,action:'memory.write',input:{botId:f.bot.botId,memoryId:'fact',expectedVersion:memory.version,text}})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'revision_conflict');
  assert.equal(f.store.read().memories.fact.version,2);
});
test('default foreign reads never permit writing the other bot memory',async t=>{
  const f=await setup(t);
  const m=await f.bots.memoryWrite(f.human,{operationId:'other-fact',action:'memory.write',input:{botId:f.other.botId,memoryId:'other',text:'shared'}});
  const binding=await f.sessions.create(f.human,{operationId:'a-session',action:'session.create',input:{botId:f.bot.botId}}),actor=f.policy.fromAgent(f.ctx.agents.get(binding.sessionId));
  assert.equal(f.bots.searchMemory(actor,{botId:f.other.botId})[0].text,'shared');
  await assert.rejects(f.bots.memoryWrite(actor,{operationId:'overwrite',action:'memory.write',input:{botId:f.other.botId,memoryId:m.memoryId,expectedVersion:m.version,text:'hijacked'}}),{code:'access_denied'});
});
test('forgotten old sources do not automatically return and logs remain intact',async t=>{
  const f=await setup(t),binding=await f.sessions.create(f.human,{operationId:'source-session',action:'session.create',input:{botId:f.bot.botId}}),agent=f.ctx.agents.get(binding.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'An old fact.'}],source:{kind:'native-plugin-test'}}));
  await eventually(()=>f.events.get(binding.sessionId)?.some(e=>e.type==='turn/end'));await f.ctx.sessions.flush(agent.session);
  const actor=f.policy.fromAgent(agent),source={sessionId:binding.sessionId,eventSeq:0};
  const memory=await f.bots.memoryWrite(actor,{operationId:'old-memory',action:'memory.write',input:{botId:f.bot.botId,memoryId:'old',text:'old',source,automatic:true}});
  await f.bots.memoryForget(f.human,{operationId:'forget',action:'memory.forget',input:{memoryId:memory.memoryId,expectedVersion:memory.version}});
  await assert.rejects(f.bots.memoryWrite(actor,{operationId:'re-add',action:'memory.write',input:{botId:f.bot.botId,memoryId:'new-id',text:'old',source,automatic:true}}),{code:'forgotten_source'});
  assert.deepEqual(f.bots.searchMemory(actor,{botId:f.bot.botId}),[]);
  assert.ok((await f.adapter.readNative(binding.sessionId)).events.length>0);
});
test('sealed memory remains absent from the same bot other conversation context',async t=>{
  const f=await setup(t),first=await f.sessions.create(f.human,{operationId:'one',action:'session.create',input:{botId:f.bot.botId}}),second=await f.sessions.create(f.human,{operationId:'two',action:'session.create',input:{botId:f.bot.botId}});
  await f.store.transact({operationId:'sealed',action:'seed',input:{}},draft=>{
    draft.meetings.m={meetingId:'m',epoch:1,phase:'independent'};
    draft.sessions[first.sessionId].lineage={meetingId:'m',epoch:1,phase:'independent'};
    draft.memories.sealed={memoryId:'sealed',botId:f.bot.botId,text:'SEALED_OPINION',version:1,forgotten:false,source:{sessionId:first.sessionId,meetingId:'m',epoch:1,phase:'independent'}};return null;
  });
  const actor=f.policy.fromAgent(f.ctx.agents.get(second.sessionId));
  assert.equal(f.bots.context(actor,second,{maxChars:12000}).includes('SEALED_OPINION'),false);
});

test('remembered shared information retains provenance and respects later source revocation',async t=>{
  const f=await setup(t);
  await f.bots.memoryWrite(f.human,{operationId:'shared',action:'memory.write',input:{botId:f.other.botId,memoryId:'shared-origin',text:'SHARED_FACT'}});
  const binding=await f.sessions.create(f.human,{operationId:'reader',action:'session.create',input:{botId:f.bot.botId}}),agent=f.ctx.agents.get(binding.sessionId);
  agent.followup(createUserMessage({content:[{type:'text',text:'Record provenance.'}],source:{kind:'native-plugin-test'}}));
  await eventually(()=>f.events.get(binding.sessionId)?.some(e=>e.type==='turn/end'));await f.ctx.sessions.flush(agent.session);
  const actor=f.policy.fromAgent(agent);assert.equal(f.bots.searchMemory(actor,{botId:f.other.botId})[0].text,'SHARED_FACT');
  const memory=await f.bots.memoryWrite(actor,{operationId:'learn',action:'memory.write',input:{botId:f.bot.botId,memoryId:'learned',text:'SHARED_FACT'}});
  assert.ok(memory.origins.some(ref=>ref.kind==='memory'&&ref.id==='shared-origin'));
  await f.policy.authorizeShare(f.human,{operationId:'unshare',action:'share.set',input:{botId:f.other.botId,share:{enabled:false,receivers:['*'],scope:{memories:['*']}}}});
  assert.equal(f.bots.context(actor,binding,{maxChars:12000}).includes('SHARED_FACT'),false);
  assert.equal(f.store.read().memories.learned.text,'SHARED_FACT','revocation preserves the historical record');
});
