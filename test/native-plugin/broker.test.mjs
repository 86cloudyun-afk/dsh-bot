import test from 'node:test';
import assert from 'node:assert/strict';
import {brokerFixture} from './broker-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';

test('duplicate sends retain the original message and produce one native turn',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),contact=await f.contact(bot);
  const command={operationId:'message',action:'session.send',input:{sessionId:contact.sessionId,text:'A new topic.',mode:'queue'}};
  const first=await f.broker.enqueue(f.human,command),again=await f.broker.enqueue(f.human,command);
  assert.equal(again.outboxId,first.outboxId);assert.equal(again.message.id,first.message.id);
  await eventually(()=>f.events.get(contact.sessionId)?.some(event=>event.type==='turn/end'));
  const history=await f.adapter.readNative(contact.sessionId);
  assert.equal(history.events.filter(event=>event.type==='user/message'&&event.data.id===first.message.id).length,1);assert.equal(f.requests.length,1);
});
test('lost delivery acknowledgement is recovered from the original native inbox',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),contact=await f.contact(bot),flush=f.ctx.sessions.flush.bind(f.ctx.sessions);let lost=false;
  f.ctx.sessions.flush=async session=>{await flush(session);if(session.id===contact.sessionId&&!lost){lost=true;throw Error('Lost acknowledgement');}};
  const row=await f.broker.enqueue(f.human,{operationId:'lost',action:'session.send',input:{sessionId:contact.sessionId,text:'Exactly one response.',mode:'queue'}});
  assert.equal(f.store.read().outbox[row.outboxId].state,'UNKNOWN');
  const recovered=await f.service.dispatch(f.human,{operationId:'reconcile',action:'outbox.reconcile',input:{outboxId:row.outboxId}});assert.equal(recovered.state,'accepted');assert.equal(recovered.message.id,row.message.id);
  await eventually(()=>f.events.get(contact.sessionId)?.some(event=>event.type==='turn/end'));assert.equal(f.requests.length,1);
});
test('closed origin pages keep task results and delivery uses an owned cold resume',async t=>{
  const f=await brokerFixture(t),bot=await f.bot(),origin=await f.contact(bot);await f.adapter.disposeOwned(origin.sessionId);assert.equal(f.ctx.agents.get(origin.sessionId),undefined);
  const task=await f.tasks.create(f.human,{operationId:'origin-task',action:'task.create',input:{botId:bot.botId,title:'Result',goal:'Return the actual response.',criteria:[],originSessionId:origin.sessionId}});
  const attempt=await f.tasks.start(f.human,{operationId:'start',action:'task.start',input:{taskId:task.taskId,expectedVersion:1}});
  await eventually(()=>Object.values(f.store.read().outbox).some(row=>row.attemptId===attempt.attemptId&&row.state==='accepted'),'durable task result delivery');
  const result=Object.values(f.store.read().outbox).find(row=>row.attemptId===attempt.attemptId);
  assert.ok(JSON.stringify(result).includes('Native test reply'));assert.equal(result.sessionId,origin.sessionId);
  await eventually(()=>f.requests.length===2);assert.equal(f.ctx.agents.get(origin.sessionId).id,origin.sessionId);
});
test('reserved short channels stay bounded while fifteen work reservations remain occupied',async t=>{
  const gate=deferred();t.after(()=>gate.resolve());const f=await brokerFixture(t,{stream:async function*(){await gate.promise;yield*textChunks('short');}}),bot=await f.bot();
  await f.store.transact({operationId:'occupied',action:'seed',input:{}},draft=>{for(let i=0;i<15;i++)draft.attempts[`held-${i}`]={attemptId:`held-${i}`,taskId:`held-${i}`,botId:bot.botId,epoch:1,state:'UNKNOWN',reservationHeld:true,depth:0};return null;});
  for(let i=0;i<4;i++){const contact=await f.contact(bot,`c-${i}`);await f.broker.enqueue(f.human,{operationId:`send-${i}`,action:'session.send',input:{sessionId:contact.sessionId,text:'Short contact.',mode:'queue'}});}
  await eventually(()=>f.requests.length>=2);assert.equal(f.requests.length,2);
  assert.equal(Object.values(f.store.read().attempts).filter(row=>row.reservationHeld).length,15);
  gate.resolve();await eventually(()=>f.requests.length===4);
});
