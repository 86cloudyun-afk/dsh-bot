import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {businessFixture} from './business-fixture.mjs';
import {eventually} from './official-fixture.mjs';

test('three named bots keep distinct identities and independent model configurations',async t=>{
  const f=await businessFixture(t),a=await f.bot('A'),b=await f.bot('B','model-b'),c=await f.bot('C','model-c');
  assert.equal(new Set([a.botId,b.botId,c.botId]).size,3);
  const renamed=await f.bots.update(f.human,{operationId:'rename',action:'bot.update',input:{botId:a.botId,expectedVersion:a.revision,name:'Renamed'}});
  assert.equal(renamed.botId,a.botId);assert.equal(renamed.name,'Renamed');
  assert.equal(f.store.read().bots[b.botId].contact.model,'model-b');
  assert.equal(f.store.read().bots[c.botId].execution.model,'model-c');
});
test('session creation binds an existing bot before the first native turn and retries its original id',async t=>{
  const f=await businessFixture(t),a=await f.bot('A'),b=await f.bot('B','model-b');
  const command={operationId:'session-a',action:'session.create',input:{botId:a.botId}};
  const first=await f.sessions.create(f.human,command),again=await f.sessions.create(f.human,command);
  assert.equal(first.sessionId,again.sessionId);assert.equal(first.botId,a.botId);
  assert.equal(Object.keys(f.store.read().bots).length,2);
  const second=await f.sessions.create(f.human,{operationId:'session-b',action:'session.create',input:{botId:b.botId}});
  for(const binding of [first,second]) {
    const agent=f.ctx.agents.get(binding.sessionId);assert.equal(f.policy.fromAgent(agent).botId,binding.botId);
    agent.followup(createUserMessage({content:[{type:'text',text:'Reply once.'}],source:{kind:'native-plugin-test'}}));
  }
  await eventually(()=>[first,second].every(row=>f.events.get(row.sessionId)?.some(e=>e.type==='turn/end')));
  assert.equal(f.requests.find(r=>r.sessionId===first.sessionId).model,'model-a');
  assert.equal(f.requests.find(r=>r.sessionId===second.sessionId).model,'model-b');
});
test('missing bot and a reused native identity cannot silently create or rebind a bot',async t=>{
  const f=await businessFixture(t),a=await f.bot('A');
  await assert.rejects(f.sessions.create(f.human,{operationId:'missing',action:'session.create',input:{botId:'missing'}}),{code:'not_found'});
  const first=await f.sessions.create(f.human,{operationId:'first',action:'session.create',input:{botId:a.botId}});
  await assert.rejects(f.sessions.create(f.human,{operationId:'rebind',action:'session.create',input:{botId:a.botId,sessionId:first.sessionId}}),{code:'invalid_input'});
  assert.equal(Object.keys(f.store.read().bots).length,1);
});
test('cold pages and management lists preserve ordinary sessions without waking agents',async t=>{
  const f=await businessFixture(t),a=await f.bot('A');
  const owned=await f.sessions.create(f.human,{operationId:'owned',action:'session.create',input:{botId:a.botId}});
  const ordinary=await f.ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:'controlled',model:'model-a'}});
  const ordinaryId=ordinary.agent.id;await f.ctx.sessions.flush(ordinary.agent.session);await ordinary.dispose();
  const agent=f.ctx.agents.get(owned.sessionId);agent.followup(createUserMessage({content:[{type:'text',text:'Harmless history.'}],source:{kind:'native-plugin-test'}}));
  await eventually(()=>f.events.get(owned.sessionId)?.some(e=>e.type==='turn/end'));await f.ctx.sessions.flush(agent.session);
  await f.adapter.disposeOwned(owned.sessionId);
  const before=f.ctx.agents.list().length,rows=await f.sessions.list(f.human,{limit:1});
  assert.equal(rows.items.length,1);assert.ok(rows.nextCursor);
  const following=await f.sessions.list(f.human,{limit:1,cursor:rows.nextCursor});
  assert.equal(following.items.length,1);assert.equal(following.nextCursor,null);
  assert.equal(new Set([...rows.items,...following.items].map(r=>r.sessionId)).size,2);
  assert.ok([...rows.items,...following.items].some(r=>r.sessionId===ordinaryId && r.type==='ordinary'));
  const page=await f.sessions.page(f.human,{sessionId:owned.sessionId,limit:2});
  assert.equal(page.events.length,2);assert.ok(page.nextCursor);
  assert.equal(f.ctx.agents.list().length,before);
});
test('foreign session creation requires a matching control grant',async t=>{
  const f=await businessFixture(t),a=await f.bot('A'),b=await f.bot('B');
  const channel=await f.sessions.create(f.human,{operationId:'a-contact',action:'session.create',input:{botId:a.botId}}),actor=f.policy.fromAgent(f.ctx.agents.get(channel.sessionId));
  await assert.rejects(f.sessions.create(actor,{operationId:'foreign-readonly',action:'session.create',input:{botId:b.botId}}),{code:'access_denied'});
  await f.policy.authorizeShare(f.human,{operationId:'allow',action:'grant.set',input:{grantId:'control',ownerBotId:b.botId,recipientBotId:a.botId,scope:{sessions:['*']},level:'control',active:true}});
  const created=await f.sessions.create(actor,{operationId:'foreign-controlled',action:'session.create',input:{botId:b.botId}});
  assert.equal(created.botId,b.botId);
});

test('queued creation freezes bot selection and configuration at admission',async t=>{
  const f=await businessFixture(t),a=await f.bot('A'),b=await f.bot('B');
  const createBot={operationId:'new-frozen',action:'bot.create',input:{name:'Frozen',cwd:f.dir,contact:{provider:'controlled',model:'model-a'}}};
  const pendingBot=f.bots.create(f.human,createBot);createBot.input.contact.model='model-b';
  assert.equal((await pendingBot).contact.model,'model-a');
  const command={operationId:'selection-frozen',action:'session.create',input:{botId:a.botId}};
  const pending=f.sessions.create(f.human,command);command.input.botId=b.botId;
  assert.equal((await pending).botId,a.botId);
});

test('public session creation cannot bypass task or meeting admission',async t=>{
  const f=await businessFixture(t),a=await f.bot('A');
  for(const purpose of ['execution','group','independent','discussion']) {
    await assert.rejects(f.sessions.create(f.human,{operationId:`bypass-${purpose}`,action:'session.create',input:{botId:a.botId,purpose}}),{code:'invalid_purpose'});
  }
  assert.equal(Object.keys(f.store.read().sessions).length,0);
});
