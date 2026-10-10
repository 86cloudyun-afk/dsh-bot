import test from 'node:test';
import assert from 'node:assert/strict';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import Fs from '@deepseek-ai/dsh-fs';
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry';
import SandboxPolicy,{setSandboxMode} from '@deepseek-ai/dsh-sandbox-policy';
import Approval,{setApprovalPolicy} from '@deepseek-ai/dsh-user-approval';
import ProjectionCache from '@deepseek-ai/dsh-session-projection-cache';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {brokerFixture} from './broker-fixture.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';

const command=(action,input,operationId=crypto.randomUUID())=>({action,input,operationId});

async function nativeControllerFixture(t,options){
  const f=await brokerFixture(t,options);
  await f.ctx.plugin(Fs).await();
  await f.ctx.plugin(AgentDefaultModel,{provider:'controlled',model:'model-b'}).await();
  await f.ctx.plugin(AgentPresets,{default:'ordinary'}).await();
  await f.ctx.agentPresets.register({id:'ordinary',plugins:[]});
  await f.ctx.plugin(SandboxPolicy,{mode:'read-only',workspaceRoot:f.dir}).await();
  await f.ctx.plugin(Approval,{policy:'ask'}).await();
  await f.ctx.plugin(SessionController,{nativeOpen:false}).await();
  await f.ctx.plugin(ProjectionCache,{writeEveryEvents:20,writeIntervalMs:1000}).await();
  assert.ok(f.ctx.sessionController instanceof SessionController);
  return f;
}

function gateAttachments(t,f,text){
  const release=deferred(),attachments=f.ctx.attachments,admit=attachments.admitPromptContent;let entered=false;
  attachments.admitPromptContent=async function(content){
    if(!entered&&content.some(part=>part.type==='text'&&part.text===text)){entered=true;await release.promise;}
    return admit.call(this,content);
  };
  t.after(()=>{release.resolve();attachments.admitPromptContent=admit;});
  return {release,entered:()=>entered};
}

async function ordinary(f){
  const row=await f.ctx.sessionController.create({cwd:f.dir,agentPreset:'ordinary'});
  const found=await f.ctx.sessionController.resolveAgent(row.sessionId);assert.ok(found.agent);
  setSandboxMode(found.agent.session,'workspace-write');setApprovalPolicy(found.agent.session,'ask');
  await f.ctx.sessions.flush(found.agent.session);
  return found.agent;
}

function poisonOwnedAdmission(f){
  for(const method of ['createOwned','resumeOwned','bindAgent'])f.adapter[method]=()=>assert.fail(`ordinary delivery must not call ${method}`);
}

for(const mode of ['queue','steer'])test(`official ordinary ${mode} admission rechecks source after attachments await and explicitly continues one original message`,async t=>{
  const f=await nativeControllerFixture(t),sender=await f.bot('Sender'),source=await f.bot('Source');
  const contact=await f.contact(sender),actor=f.policy.fromAgent(f.ctx.agents.get(contact.sessionId)),agent=await ordinary(f);
  const before=await f.adapter.inspectSession(agent.id),global=f.ctx.agentDefaultModel.currentSelection();
  await f.policy.authorizeShare(f.human,command('grant.set',{grantId:'ordinary-control',ownerBotId:null,recipientBotId:sender.botId,level:'control',scope:{sessions:[agent.id]},active:true}));
  const memory=await f.bots.memoryWrite(f.human,command('memory.write',{botId:source.botId,text:'Native original source marker'}));
  f.policy.noteRead(actor,{kind:'memory',id:memory.memoryId});
  poisonOwnedAdmission(f);
  const nativeBindings=[],bind=f.ctx.fileUploads.bindPrompt;
  f.ctx.fileUploads.bindPrompt=function(...args){nativeBindings.push(args);return bind.apply(this,args);};
  const gate=gateAttachments(t,f,'Native original source marker'),send=command('session.send',{sessionId:agent.id,text:'Native original source marker',mode});
  const pending=f.broker.enqueue(actor,send);
  await eventually(gate.entered,'official attachment admission');
  await f.policy.authorizeShare(f.human,command('share.set',{botId:source.botId,share:{enabled:false,receivers:[],scope:{}}}));
  assert.equal(f.policy.canRead(actor,{kind:'memory',id:memory.memoryId}),false);
  gate.release.resolve();const blocked=await pending;
  assert.equal(blocked.state,'blocked');assert.equal(blocked.nativeAdmission,false);assert.equal(blocked.error,'access_denied');
  assert.equal(f.requests.length,0);assert.equal(f.store.read().sessions[agent.id],undefined);
  const unadmitted=await f.adapter.inspectSession(agent.id);
  assert.equal(unadmitted.events.some(event=>event.type==='user/message'||event.type==='agent/inbox/spliced'),false);
  const receipt=f.store.read().operations[send.operationId];
  await f.policy.authorizeShare(f.human,command('share.set',{botId:source.botId,share:{enabled:true,receivers:['*'],scope:{sessions:['*'],tasks:['*'],memories:['*'],materials:['*']}}}));
  const continued=await Promise.all([0,1].map(()=>f.broker.reconcile(f.human,command('outbox.reconcile',{outboxId:blocked.outboxId}))));
  for(const accepted of continued){assert.equal(accepted.state,'accepted');assert.equal(accepted.outboxId,blocked.outboxId);assert.equal(accepted.message.id,blocked.message.id);assert.equal(accepted.operationId,send.operationId);}
  await agent.whenIdle();await f.ctx.sessions.flush(agent.session);
  const after=await f.adapter.readNative(agent.id),messages=after.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId===blocked.message.id);
  assert.equal(messages.length,1);assert.equal(messages[0].data.id,blocked.message.id);assert.deepEqual(messages[0].data.source,{kind:'user',rpcId:blocked.message.id});
  const queued=after.events.find(event=>event.type==='agent/inbox/spliced'&&event.data.inserted.some(message=>message.id===blocked.message.id));
  assert.equal(queued.data.target,mode==='steer'?'next-step':'next-turn');
  assert.equal(nativeBindings.length,2);
  for(const [receivingAgent,receiptIds,requestId] of nativeBindings){assert.equal(receivingAgent,agent);assert.deepEqual(receiptIds,[]);assert.equal(requestId,blocked.message.id);}
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].model,'model-b');assert.equal(f.ctx.agents.get(agent.id),agent);
  assert.deepEqual(after.header,before.header);assert.equal(f.ctx.agentPresets.composedPreset(agent.ctx),'ordinary');
  assert.equal(f.ctx.sandboxPolicy.resolve({session:agent.session}).mode,'workspace-write');assert.equal(f.ctx.approval.effectivePolicy(agent.session),'ask');
  assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(),global);assert.equal(f.store.read().sessions[agent.id],undefined);
  const duplicate=await f.broker.enqueue(actor,send);assert.equal(duplicate.message.id,blocked.message.id);assert.equal(duplicate.outboxId,blocked.outboxId);
  assert.deepEqual(f.store.read().operations[send.operationId],receipt);assert.equal(f.requests.length,1);
});

for(const change of ['archive','broker-close','agent-disposal'])test(`ordinary native attachment preparation is proved unadmitted after ${change}`,async t=>{
  const f=await nativeControllerFixture(t);
  let handle,agent;
  if(change==='agent-disposal'){
    handle=await f.ctx.agents.create({sessionId:crypto.randomUUID(),meta:{cwd:f.dir},agentOptions:{provider:'controlled',model:'model-b'}});
    agent=handle.agent;
  }else agent=await ordinary(f);
  const gate=gateAttachments(t,f,'Admission boundary marker'),pending=f.broker.enqueue(f.human,command('session.send',{sessionId:agent.id,text:'Admission boundary marker'}));
  await eventually(gate.entered,'official attachment admission');
  let closing;
  if(change==='archive')await f.sessions.archive(f.human,command('session.archive',{sessionId:agent.id}));
  else if(change==='broker-close')closing=f.broker.close();
  else await handle.dispose();
  gate.release.resolve();const blocked=await pending;await closing;
  assert.equal(blocked.state,'blocked');assert.equal(blocked.nativeAdmission,false);assert.equal(f.requests.length,0);
  assert.equal((f.events.get(agent.id)??[]).some(event=>event.type==='user/message'||event.type==='agent/inbox/spliced'),false);
});

test('ordinary lost flush acknowledgement stays UNKNOWN until native evidence reconciliation without duplicate admission',async t=>{
  const f=await nativeControllerFixture(t),agent=await ordinary(f),flush=f.ctx.sessions.flush;let lost=false;
  f.ctx.sessions.flush=async function(session){await flush.call(this,session);if(session===agent.session&&!lost){lost=true;throw Error('Controlled native flush acknowledgement loss');}};
  const send=command('session.send',{sessionId:agent.id,text:'Original unknown message'}),row=await f.broker.enqueue(f.human,send);
  assert.equal(row.state,'UNKNOWN');assert.equal(row.nativeAdmission,true);
  assert.equal((await f.broker.enqueue(f.human,send)).state,'UNKNOWN');assert.equal((await f.broker.deliver(row.outboxId)).state,'UNKNOWN');
  const accepted=await f.broker.reconcile(f.human,command('outbox.reconcile',{outboxId:row.outboxId}));
  assert.equal(accepted.state,'accepted');assert.equal(accepted.message.id,row.message.id);assert.equal(accepted.operationId,send.operationId);
  await agent.whenIdle();const native=await f.adapter.inspectSession(agent.id);
  const messages=native.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId===row.message.id);
  assert.equal(messages.length,1);assert.equal(messages[0].data.id,row.message.id);assert.equal(f.requests.length,1);
});

test('ordinary cold delivery uses the official resolver and preserves selected model, preset, scope and global default',async t=>{
  const f=await nativeControllerFixture(t),id=crypto.randomUUID();
  const handle=await f.ctx.agents.create({sessionId:id,meta:{cwd:f.dir,agentPreset:'ordinary'},agentOptions:{provider:'controlled',model:'model-a'},setup:async ctx=>{await f.ctx.agentPresets.mount(ctx,'ordinary');}});
  setSandboxMode(handle.agent.session,'workspace-write');setApprovalPolicy(handle.agent.session,'ask');
  await f.ctx.sessionController.selectModel({sessionId:id,provider:'controlled',model:'model-a'});
  await f.ctx.sessionController.prompt({sessionId:id,requestId:'ordinary-existing-turn',content:[{type:'text',text:'Persist the ordinary model selection'}],mode:'queue'},new AbortController().signal);
  await handle.agent.whenIdle();await f.ctx.sessions.flush(handle.agent.session);
  const before=await f.adapter.readNative(id);await handle.dispose();assert.equal(f.ctx.agents.get(id),undefined);
  poisonOwnedAdmission(f);
  const send=command('session.send',{sessionId:id,text:'Cold original message'}),row=await f.broker.enqueue(f.human,send);
  assert.equal(row.state,'accepted');const resumed=f.ctx.agents.get(id);assert.ok(resumed);assert.notEqual(resumed,handle.agent);
  await resumed.whenIdle();await f.ctx.sessions.flush(resumed.session);
  const after=await f.adapter.readNative(id);
  assert.deepEqual(after.header,before.header);assert.equal(f.ctx.agentPresets.composedPreset(resumed.ctx),'ordinary');
  assert.equal(f.ctx.sandboxPolicy.resolve({session:resumed.session}).mode,'workspace-write');assert.equal(f.ctx.approval.effectivePolicy(resumed.session),'ask');
  assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(),{provider:'controlled',model:'model-b'});
  assert.equal(f.store.read().sessions[id],undefined);assert.equal(f.requests.length,2);assert.ok(f.requests.every(request=>request.model==='model-a'));
  const message=after.events.find(event=>event.type==='user/message'&&event.data.source?.rpcId===row.message.id);assert.equal(message.data.id,row.message.id);
  assert.equal((await f.broker.enqueue(f.human,send)).message.id,row.message.id);assert.equal(f.requests.length,2);
});

test('a genuine Bot native tool resumes and sends to an authorized cold ordinary Session without adopting it',async t=>{
  let contactId,targetId,sent=false;
  const f=await nativeControllerFixture(t,{stream:async function*(options){
    if(options.sessionId===contactId&&!sent){
      sent=true;
      yield {type:'block-start',index:0,blockType:'tool-call'};
      yield {type:'block-end',index:0,block:{type:'tool-call',id:'cold-ordinary-tool',name:'dsh_bot',arguments:JSON.stringify(command('session.send',{sessionId:targetId,text:'Authorized native tool message'},'cold-native-tool-send'))}};
      yield {type:'finish',reason:{kind:'tool-calls'}};
    }else yield*textChunks('Controlled native ordinary reply');
  }});
  targetId=crypto.randomUUID();
  const handle=await f.ctx.agents.create({sessionId:targetId,meta:{cwd:f.dir},agentOptions:{provider:'controlled',model:'model-b'}});
  await f.ctx.sessionController.prompt({sessionId:targetId,requestId:'native-tool-existing-turn',content:[{type:'text',text:'Persist an existing ordinary target'}],mode:'queue'},new AbortController().signal);
  await handle.agent.whenIdle();await f.ctx.sessions.flush(handle.agent.session);await handle.dispose();
  const sender=await f.bot('NativeToolSender'),contact=await f.contact(sender);contactId=contact.sessionId;
  await f.policy.authorizeShare(f.human,command('grant.set',{grantId:'native-ordinary-control',ownerBotId:null,recipientBotId:sender.botId,level:'control',scope:{sessions:[targetId]},active:true}));
  poisonOwnedAdmission(f);
  const senderAgent=f.ctx.agents.get(contactId);
  senderAgent.followup(createUserMessage({content:[{type:'text',text:'Use the authorized ordinary Session'}],source:{kind:'v113-native-admission-test'}}));
  await senderAgent.whenIdle();
  const row=Object.values(f.store.read().outbox).find(row=>row.operationId==='cold-native-tool-send');
  assert.ok(row,'the genuine native tool must use the broker');assert.equal(row.state,'accepted');
  const target=f.ctx.agents.get(targetId);assert.ok(target);await target.whenIdle();await f.ctx.sessions.flush(target.session);
  const native=await f.adapter.readNative(targetId),messages=native.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId===row.message.id);
  assert.equal(messages.length,1);assert.equal(messages[0].data.id,row.message.id);assert.equal(f.store.read().sessions[targetId],undefined);
  assert.equal(f.requests.filter(request=>request.sessionId===targetId).length,2);assert.equal(f.requests.filter(request=>request.sessionId===contactId).length,2);
  assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(),{provider:'controlled',model:'model-b'});
  for(const delegated of [false,true]){
    const unadmittedId=crypto.randomUUID();
    await assert.rejects(f.ctx.agents.withInitiator(senderAgent,()=>f.ctx.agents.create({sessionId:unadmittedId,
      ...(delegated?{parentAgent:senderAgent}:{}),meta:{cwd:f.dir,...(delegated?{parentSession:senderAgent.id,origin:'subagent',delegationDepth:1}:{})},
      agentOptions:{provider:'controlled',model:'model-a'}})),{code:'work_admission_required'});
    assert.equal(f.ctx.agents.get(unadmittedId),undefined);
  }
  assert.equal(f.requests.length,4);
});

test('ordinary public resolver rejects an actual native subagent target without admitting its message',async t=>{
  const f=await nativeControllerFixture(t),parent=await ordinary(f),id=crypto.randomUUID();
  const child=await f.ctx.agents.create({sessionId:id,parentAgent:parent,meta:{cwd:f.dir,parentSession:parent.id,origin:'subagent',delegationDepth:1},agentOptions:{provider:'controlled',model:'model-b'}});
  t.after(()=>child.dispose());
  const row=await f.broker.enqueue(f.human,command('session.send',{sessionId:id,text:'Do not bypass native child ownership'}));
  assert.equal(row.state,'blocked');assert.equal(row.nativeAdmission,false);assert.equal(f.requests.length,0);
  assert.equal((await f.adapter.inspectSession(id)).events.some(event=>event.type==='user/message'||event.type==='agent/inbox/spliced'),false);
});

test('ordinary public resolution of a missing Session never creates or adopts an Agent',async t=>{
  const f=await nativeControllerFixture(t),id=crypto.randomUUID();poisonOwnedAdmission(f);
  const row=await f.broker.enqueue(f.human,command('session.send',{sessionId:id,text:'No new ordinary execution admission'}));
  assert.equal(row.state,'blocked');assert.equal(row.nativeAdmission,false);
  assert.equal(f.ctx.agents.get(id),undefined);assert.equal(f.ctx.sessions.get(id),undefined);assert.equal(f.store.read().sessions[id],undefined);
  assert.equal(f.requests.length,0);assert.equal(await f.ctx.sessionPersistence.stat(id),undefined);
});
