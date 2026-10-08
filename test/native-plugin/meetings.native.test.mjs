import test from 'node:test';
import assert from 'node:assert/strict';
import {collaborationFixture} from './collaboration-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';

test('sealed opinions cannot enter a same Bot other conversation through any business read or send',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());const f=await collaborationFixture(t,{stream:async function*(){await gate.promise;yield*textChunks('SEALED-OPINION');}}),a=await f.bot('A'),b=await f.bot('B'),group=await f.group('Sealed',[a,b]),meeting=await f.meeting(group),contact=await f.contact(a);
  await eventually(()=>f.requests.length===2);const channel=f.store.read().meetings[meeting.meetingId].participants.find(row=>row.botId===a.botId).sessionId,independent=f.policy.fromAgent(f.ctx.agents.get(channel)),ordinary=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  await f.ctx.sessions.flush(independent.agent.session);await f.bots.memoryWrite(independent,{operationId:'sealed-memory',action:'memory.write',input:{botId:a.botId,text:'SEALED-OPINION',source:{sessionId:channel,eventSeq:independent.agent.session.seq-1}}});
  assert.equal(f.bots.searchMemory(ordinary,{botId:a.botId,query:'SEALED'}).length,0);
  await assert.rejects(f.sessions.page(ordinary,{sessionId:channel}),{code:'access_denied'});
  assert.equal((await f.bots.context(ordinary,f.store.read().sessions[contact.sessionId])).includes('SEALED-OPINION'),false);
  const forwarded=await f.broker.enqueue(independent,{operationId:'sealed-forward',action:'session.send',input:{sessionId:contact.sessionId,text:'SEALED-OPINION'}});assert.equal(forwarded.state,'blocked');
  gate.resolve();await eventually(()=>Object.keys(f.store.read().meetings[meeting.meetingId].opinions).length===2);
  const hidden=f.service.snapshot(ordinary).meetings.find(row=>row.meetingId===meeting.meetingId);assert.deepEqual(hidden.opinions,{});
  await f.collaboration.advance(f.human,{operationId:'reveal',action:'meeting.advance',input:{meetingId:meeting.meetingId,epoch:1,phase:'independent'}});
  assert.equal(Object.keys(f.service.snapshot(ordinary).meetings.find(row=>row.meetingId===meeting.meetingId).opinions).length,2);
});
test('late independent output from a removed and rejoined member is excluded',async t=>{
  const old=deferred(),fresh=deferred();t.after(()=>{old.resolve();fresh.resolve();});let f,a;
  f=await collaborationFixture(t,{stream:async function*(options){const lineage=f.store.read().sessions[options.sessionId]?.lineage;if(lineage?.botId===a.botId){if(lineage.memberEpoch===1){await old.promise;yield*textChunks('OLD-OPINION');}else{await fresh.promise;yield*textChunks('NEW-OPINION');}}else yield*textChunks('Other opinion');}});
  a=await f.bot('A');const b=await f.bot('B'),group=await f.group('Rejoin',[a,b]),meeting=await f.meeting(group);await eventually(()=>f.requests.length===2);
  let current=f.store.read().groups[group.groupId];await f.collaboration.changeMembers(f.human,{operationId:'remove',action:'group.members',input:{groupId:group.groupId,expectedVersion:current.version,botIds:[b.botId],coordinatorBotId:b.botId}});
  current=f.store.read().groups[group.groupId];await f.collaboration.changeMembers(f.human,{operationId:'rejoin',action:'group.members',input:{groupId:group.groupId,expectedVersion:current.version,botIds:[a.botId,b.botId],coordinatorBotId:b.botId}});
  old.resolve();await eventually(()=>f.requests.length===3);assert.equal(f.store.read().meetings[meeting.meetingId].opinions[a.botId],undefined);
  fresh.resolve();await eventually(()=>f.store.read().meetings[meeting.meetingId].opinions[a.botId]?.text==='NEW-OPINION');
  assert.equal(f.store.read().meetings[meeting.meetingId].opinions[a.botId].memberEpoch,3);
});
test('topic changes fence old meeting output without replacing task or session identities',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());let first=true;const f=await collaborationFixture(t,{stream:async function*(){if(first){first=false;await gate.promise;yield*textChunks('OLD-TOPIC');}else yield*textChunks('NEW-TOPIC');}}),a=await f.bot('A'),group=await f.group('Topic',[a]),meeting=await f.meeting(group,'Old');
  await eventually(()=>f.requests.length===1);const oldId=f.store.read().meetings[meeting.meetingId].participants[0].sessionId;
  await f.collaboration.changeTopic(f.human,{operationId:'topic',action:'meeting.topic',input:{meetingId:meeting.meetingId,epoch:1,topic:'New',materials:'New material'}});gate.resolve();
  await eventually(()=>f.store.read().meetings[meeting.meetingId].opinions[a.botId]?.text==='NEW-TOPIC');
  const current=f.store.read().meetings[meeting.meetingId];assert.equal(current.epoch,2);assert.notEqual(current.participants[0].sessionId,oldId);assert.ok(f.store.read().sessions[oldId]);
});
