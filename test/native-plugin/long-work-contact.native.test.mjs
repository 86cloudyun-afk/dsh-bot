import test from 'node:test';
import assert from 'node:assert/strict';
import {brokerFixture} from './broker-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';

test('a real long native tool allows independent contact and a short task before it settles',async t=>{
  const barrier=deferred();t.after(()=>barrier.resolve());let longSession,entered=false;
  const f=await brokerFixture(t,{stream:async function*(options){
    if(!longSession&&JSON.stringify(options.messages).includes('执行任务 Long'))longSession=options.sessionId;
    if(options.sessionId===longSession&&!entered){
      const block={type:'tool-call',id:'long-call',name:'long_probe',arguments:'{}'};
      yield {type:'block-start',index:0,blockType:'tool-call'};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'tool-calls'}};
    }else yield*textChunks(options.sessionId===longSession?'Long completed':'Independent short answer');
  }}),bot=await f.bot();
  await f.bots.update(f.human,{operationId:'capabilities',action:'bot.update',input:{botId:bot.botId,expectedVersion:bot.revision,capabilities:['long_probe']}});
  const release=f.ctx.tools.register({name:'long_probe',description:'A harmless owned test barrier.',parameters:{type:'object'},output:{schema:{type:'object'},render:()=>[{type:'text',text:'Barrier released'}]},execute:async()=>{entered=true;await barrier.promise;return {};}});t.after(release);
  const long=await f.task(bot,'Long'),attempt=await f.tasks.start(f.human,{operationId:'long-start',action:'task.start',input:{taskId:long.taskId,expectedVersion:1}});longSession=attempt.sessionId;
  await eventually(()=>entered,'real native tool entry');
  const contact=await f.contact(bot);await f.broker.enqueue(f.human,{operationId:'new-topic',action:'session.send',input:{sessionId:contact.sessionId,text:'An unrelated new topic.',mode:'queue'}});
  await eventually(()=>f.events.get(contact.sessionId)?.some(row=>row.type==='assistant/message'),'independent model answer');
  const short=await f.task(bot,'Short'),shortAttempt=await f.tasks.start(f.human,{operationId:'short-start',action:'task.start',input:{taskId:short.taskId,expectedVersion:1}});
  await eventually(()=>f.store.read().attempts[shortAttempt.attemptId].state==='returned','short task settlement').catch(async error=>{error.message+=JSON.stringify({attempt:f.store.read().attempts[shortAttempt.attemptId],resources:f.adapter.resources(shortAttempt.sessionId),events:(await f.adapter.readNative(shortAttempt.sessionId)).events.filter(row=>['turn/end','assistant/message'].includes(row.type))});throw error;});
  assert.equal(f.store.read().attempts[attempt.attemptId].reservationHeld,true);assert.equal(f.adapter.resources(longSession).tools,1);
  assert.ok(f.requests.some(row=>row.sessionId===contact.sessionId));assert.notEqual(contact.sessionId,longSession);barrier.resolve();
  await eventually(()=>!f.store.read().attempts[attempt.attemptId].reservationHeld);
});
