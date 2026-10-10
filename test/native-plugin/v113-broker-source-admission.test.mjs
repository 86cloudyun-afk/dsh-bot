import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {brokerFixture} from './broker-fixture.mjs';
import {eventually} from './official-fixture.mjs';

const command=(operationId,action,input)=>({operationId,action,input});

// Removing the sender's derived-source check must fail both real admission boundaries.
for(const boundary of ['session.send','outbox.admitting'])test(`ordinary message rechecks its source after ${boundary} commits`,async t=>{
  const f=await brokerFixture(t),sender=await f.bot('Sender'),source=await f.bot('Source');
  const contact=await f.contact(sender),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId));
  const ordinary=await f.ctx.agents.create({sessionId:randomUUID(),meta:{cwd:f.dir},agentOptions:{provider:'controlled',model:'model-a'}});
  t.after(()=>ordinary.dispose());await f.ctx.sessions.flush(ordinary.agent.session);
  let admitted=0;
  // Official Agent/inbox/native-log/provider and attachment bindings are real; only resolution is a facade.
  f.ctx.provide('sessionController',{async resolveAgent(sessionId){
    assert.equal(sessionId,ordinary.agent.id);admitted++;
    return {agent:ordinary.agent};
  }});
  await f.policy.authorizeShare(f.human,command('ordinary-control','grant.set',{
    grantId:'ordinary',ownerBotId:null,recipientBotId:sender.botId,level:'control',scope:{sessions:[ordinary.agent.id]},active:true,
  }));
  const memory=await f.bots.memoryWrite(f.human,command('source-memory','memory.write',{botId:source.botId,text:'Shared task detail'}));
  f.policy.noteRead(actor,{kind:'memory',id:memory.memoryId});
  const transact=f.store.transact.bind(f.store);let changed=false;
  f.store.transact=async (request,mutate)=>{
    const result=await transact(request,mutate);
    if(request.action===boundary&&!changed){
      changed=true;
      await f.policy.authorizeShare(f.human,command('source-share-off','share.set',{
        botId:source.botId,share:{enabled:false,receivers:[],scope:{}},
      }));
    }
    return result;
  };
  const send=command('derived-message','session.send',{sessionId:ordinary.agent.id,text:'Shared task detail'});
  const blocked=await f.broker.enqueue(actor,send);
  assert.equal(changed,true);
  assert.equal(blocked.state,'blocked');assert.equal(blocked.nativeAdmission,false);assert.equal(blocked.error,'access_denied');
  assert.equal(admitted,0);assert.equal(f.requests.length,0);
  const before=await f.adapter.readNative(ordinary.agent.id);
  assert.equal(before.events.some(event=>event.type==='user/message'||event.type==='agent/inbox/spliced'),false);
  const receipt=f.store.read().operations[send.operationId];assert.equal(receipt.result.message.id,blocked.message.id);
  // A proved unadmitted message may be explicitly continued after sharing is restored.
  await f.policy.authorizeShare(f.human,command('source-share-on','share.set',{
    botId:source.botId,share:{enabled:true,receivers:['*'],scope:{sessions:['*'],tasks:['*'],memories:['*'],materials:['*']}},
  }));
  const accepted=await f.broker.reconcile(f.human,command('continue-original-message','outbox.reconcile',{outboxId:blocked.outboxId}));
  assert.equal(accepted.state,'accepted');assert.equal(accepted.outboxId,blocked.outboxId);assert.equal(accepted.message.id,blocked.message.id);
  await eventually(()=>f.events.get(ordinary.agent.id)?.some(event=>event.type==='turn/end'));
  assert.equal(admitted,1);assert.equal(f.requests.length,1);
  const after=await f.adapter.readNative(ordinary.agent.id);
  assert.equal(after.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId===blocked.message.id).length,1);
  const duplicate=await f.broker.enqueue(actor,send);
  assert.equal(duplicate.outboxId,blocked.outboxId);assert.equal(duplicate.message.id,blocked.message.id);assert.equal(admitted,1);
});
