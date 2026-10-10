import test from 'node:test';
import assert from 'node:assert/strict';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {taskFixture} from './task-fixture.mjs';
import {eventually} from './official-fixture.mjs';
import {MemoryController} from '../../src/native/memory.mjs';
import {KnowledgeController} from '../../src/native/knowledge.mjs';
import {GroupMeetingController} from '../../src/native/collaboration.mjs';
import {BotService} from '../../src/native/service.mjs';

const command=(action,input,operationId=crypto.randomUUID())=>({action,input,operationId});
const message=text=>createUserMessage({content:[{type:'text',text}],source:{kind:'user'}});
async function fixture(t,count=1) {
  const f=await taskFixture(t),knowledge=new KnowledgeController(f),memory=new MemoryController({...f,knowledge}),
    collaboration=new GroupMeetingController(f),service=new BotService({...f,knowledge,memory,collaboration});
  f.bots.setMemoryController(memory);f.adapter.setService(service);
  f.beforeClose.push(()=>collaboration.close());
  const contacts=[];
  for(let i=0;i<count;i++) {
    const bot=await f.bot(`Provenance${i}`),binding=await f.sessions.create(f.human,command('session.create',{botId:bot.botId})),
      agent=f.ctx.agents.get(binding.sessionId),actor=f.policy.fromAgent(agent);
    contacts.push({bot,binding,agent,actor});
  }
  return {...f,knowledge,memory,collaboration,service,contacts};
}
async function reply(f,agent,text) {
  const before=f.requests.filter(row=>row.sessionId===agent.id).length;
  agent.followup(message(text));await agent.whenIdle();
  assert.equal(f.requests.filter(row=>row.sessionId===agent.id).length,before+1);
  await f.ctx.sessions.flush(agent.session);
}
const ownRef=contact=>({kind:'session',id:contact.binding.sessionId});

test('v1.1.3 real own-memory tool publishes its receipt and permits the next native chat',async t=>{
  const f=await fixture(t),{bot,agent,actor,binding}=f.contacts[0];
  await reply(f,agent,'Remember my normal preference.');
  const request=command('memory.write',{botId:bot.botId,text:'Normal preference'},'remember-native-preference');
  const result=await f.ctx.tools.execute({callId:'remember',name:'dsh_bot',agent,signal:new AbortController().signal,arguments:request});
  assert.equal(result.isError,false,JSON.stringify(result));
  const memory=Object.values(f.store.read().memories)[0];
  assert.ok(memory.source.eventHash);assert.equal(memory.source.sessionId,binding.sessionId);
  assert.ok(memory.origins.some(ref=>ref.kind==='session'&&ref.id===binding.sessionId));
  assert.equal(f.policy.canRead(actor,ownRef(f.contacts[0])),true);
  assert.equal(f.policy.readDependencies(actor).some(ref=>ref.kind==='session'&&ref.id===binding.sessionId),false);
  assert.deepEqual(await f.service.dispatch(actor,request),f.store.read().operations[request.operationId].result);
  await reply(f,agent,'Continue independent contact.');
  assert.equal(f.requests.length,2);
});

test('v1.1.3 existing reflexive session provenance recovers without replacing memory or receipts',async t=>{
  const f=await fixture(t),contact=f.contacts[0];await reply(f,contact.agent,'Source for a retained fact.');
  const request=command('memory.write',{botId:contact.bot.botId,text:'Retained fact'},'retained-fact'),
    memory=await f.memory.write(contact.actor,request);
  await f.store.transact(command('fixture.legacy-self-origin',{}),draft=>{
    draft.sessions[contact.binding.sessionId].origins=[ownRef(contact)];return null;
  });
  const before=f.store.read(),result=await f.service.dispatch(contact.actor,{action:'memory.search',input:{botId:contact.bot.botId}});
  assert.equal(result.length,1);
  assert.equal(result[0].memoryId,memory.memoryId);
  assert.deepEqual(f.store.read().memories,before.memories);
  for(const [id,receipt] of Object.entries(before.operations))assert.deepEqual(f.store.read().operations[id],receipt);
  assert.equal(f.policy.canRead(contact.actor,ownRef(contact)),true);
  await reply(f,contact.agent,'Use the original contact after upgrade.');
});

for(const count of [2,3])test(`v1.1.3 ${count} reciprocal default readonly snapshots preserve native contact`,async t=>{
  const f=await fixture(t,count);
  for(const contact of f.contacts) {
    const snapshot=await f.service.dispatch(contact.actor,{action:'snapshot'});
    assert.equal(snapshot.sessions.length,count);
  }
  const state=f.store.read();
  for(const contact of f.contacts) {
    for(const other of f.contacts.filter(row=>row!==contact))assert.ok(state.sessions[contact.binding.sessionId].origins.some(ref=>ref.kind==='session'&&ref.id===other.binding.sessionId));
    assert.equal(f.policy.canRead(contact.actor,ownRef(contact)),true);
    await reply(f,contact.agent,'Normal chat after current readonly snapshots.');
  }
  assert.equal(f.requests.length,count);
});

test('v1.1.3 reciprocal context dependencies recheck every current foreign sharing ceiling',async t=>{
  const f=await fixture(t,3),[a,b,c]=f.contacts;
  await f.store.transact(command('fixture.context-graph',{}),draft=>{
    draft.sessions[a.binding.sessionId].origins=[ownRef(b)];
    draft.sessions[b.binding.sessionId].origins=[ownRef(a),ownRef(c)];
    draft.sessions[c.binding.sessionId].origins=[ownRef(b)];return null;
  });
  assert.equal(f.policy.canRead(a.actor,ownRef(a)),true);
  await f.policy.authorizeShare(f.human,command('share.set',{botId:c.bot.botId,share:{enabled:false,receivers:['*'],scope:{sessions:['*']}}}));
  assert.equal(f.policy.canRead(a.actor,ownRef(a)),false);
  assert.equal(f.policy.canRead(b.actor,ownRef(b)),false);
  const blocked=await f.ctx.tools.execute({callId:'revoked-snapshot',name:'dsh_bot',agent:a.agent,signal:new AbortController().signal,arguments:{action:'snapshot'}});
  assert.equal(blocked.isError,true);
  a.agent.followup(message('Revoked transitive source must block this model.'));await a.agent.whenIdle();
  assert.equal(f.requests.length,0);
});

test('v1.1.3 a reflexive context origin does not bypass a different revoked source',async t=>{
  const f=await fixture(t,2),[a,b]=f.contacts;
  await f.store.transact(command('fixture.old-reflexive-and-foreign',{}),draft=>{
    draft.sessions[a.binding.sessionId].origins=[ownRef(a),ownRef(b)];return null;
  });
  await f.policy.authorizeShare(f.human,command('share.set',{botId:b.bot.botId,share:{enabled:false,receivers:['*'],scope:{sessions:['*']}}}));
  assert.equal(f.policy.canRead(a.actor,ownRef(a)),false);
  assert.equal(f.requests.length,0);
});

test('v1.1.3 context dependency backedges never disclose a real sealed meeting channel',async t=>{
  const f=await fixture(t,2),[a,b]=f.contacts;
  const group=await f.collaboration.createGroup(f.human,command('group.create',{name:'Independent evidence',botIds:[a.bot.botId,b.bot.botId],coordinatorBotId:a.bot.botId})),
    meeting=await f.collaboration.startMeeting(f.human,command('meeting.start',{groupId:group.groupId,topic:'Private independent opinions',materials:''}));
  await eventually(()=>Object.keys(f.store.read().meetings[meeting.meetingId].opinions).length===2);
  const sealed=f.store.read().meetings[meeting.meetingId].participants.find(row=>row.botId===a.bot.botId).sessionId;
  await f.store.transact(command('fixture.context-with-sealed-leaf',{}),draft=>{
    draft.sessions[a.binding.sessionId].origins=[ownRef(b)];
    draft.sessions[b.binding.sessionId].origins=[ownRef(a),{kind:'session',id:sealed}];return null;
  });
  assert.equal(f.policy.canRead(a.actor,ownRef(a)),false);
  assert.equal(f.policy.canRead(b.actor,ownRef(b)),false);
  assert.equal(f.policy.canRead(a.actor,{kind:'session',id:sealed}),false);
});

test('v1.1.3 genuine source-session lineage cycles remain denied',async t=>{
  const f=await fixture(t,2),[a,b]=f.contacts;
  await f.store.transact(command('fixture.source-cycle',{}),draft=>{
    draft.sessions[a.binding.sessionId].source={kind:'session',sessionId:b.binding.sessionId};
    draft.sessions[b.binding.sessionId].source={kind:'session',sessionId:a.binding.sessionId};return null;
  });
  assert.equal(f.policy.canRead(a.actor,ownRef(a)),false);
  assert.equal(f.policy.canRead(b.actor,ownRef(b)),false);
  assert.equal(f.requests.length,0);
});
