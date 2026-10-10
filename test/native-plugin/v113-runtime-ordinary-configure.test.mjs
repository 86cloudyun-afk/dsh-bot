import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import SessionController from '@deepseek-ai/dsh-api-session-controller';
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model';
import Fs from '@deepseek-ai/dsh-fs';
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry';
import SandboxPolicy,{setSandboxMode} from '@deepseek-ai/dsh-sandbox-policy';
import Approval,{setApprovalPolicy} from '@deepseek-ai/dsh-user-approval';
import ProjectionCache from '@deepseek-ai/dsh-session-projection-cache';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {childSessionMeta} from '@deepseek-ai/dsh-subagent';
import {NativeDshAdapter} from '../../src/native/adapter.mjs';
import {brokerFixture} from './broker-fixture.mjs';
import {deferred,textChunks} from './official-fixture.mjs';

const command=(action,input,operationId=crypto.randomUUID())=>({action,input,operationId});
async function fixture(t,options){
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
async function prompt(f,agent,text){
  await f.ctx.sessionController.prompt({sessionId:agent.id,requestId:crypto.randomUUID(),content:[{type:'text',text}],mode:'queue'},new AbortController().signal);
  await agent.whenIdle();await f.ctx.sessions.flush(agent.session);
}
async function ordinary(f){
  return f.ctx.agents.create({sessionId:crypto.randomUUID(),meta:{cwd:f.dir,agentPreset:'ordinary'},agentOptions:{provider:'controlled',model:'model-b'},
    setup:async ctx=>{await f.ctx.agentPresets.mount(ctx,'ordinary');}});
}

test('genuine Bot tool configures an authorized cold ordinary Session once and leaves controller ownership after adapter close',async t=>{
  let contactId,targetId,issued=false;
  const operationId='ordinary-cold-native-configure',f=await fixture(t,{stream:async function*(options){
    if(options.sessionId===contactId&&!issued){issued=true;
      yield {type:'block-start',index:0,blockType:'tool-call'};
      yield {type:'block-end',index:0,block:{type:'tool-call',id:'ordinary-config-tool',name:'dsh_bot',arguments:JSON.stringify(command('session.configure',{sessionId:targetId,expectedVersion:1,name:'Native ordinary renamed'},operationId))}};
      yield {type:'finish',reason:{kind:'tool-calls'}};
    }else yield*textChunks('Controlled ordinary configuration reply');
  }});
  const handle=await ordinary(f);targetId=handle.agent.id;
  setSandboxMode(handle.agent.session,'workspace-write');setApprovalPolicy(handle.agent.session,'ask');
  await f.ctx.sessionController.selectModel({sessionId:targetId,provider:'controlled',model:'model-a'});
  await prompt(f,handle.agent,'Persist an existing ordinary Session');
  const before=await f.adapter.inspectSession(targetId);await handle.dispose();assert.equal(f.ctx.agents.get(targetId),undefined);
  const bot=await f.bot('NativeConfigureSender'),contact=await f.contact(bot);contactId=contact.sessionId;
  await f.policy.authorizeShare(f.human,command('grant.set',{grantId:'native-config-control',ownerBotId:null,recipientBotId:bot.botId,level:'control',scope:{sessions:[targetId]},active:true}));
  for(const method of ['createOwned','resumeOwned','bindAgent'])f.adapter[method]=()=>assert.fail(`ordinary configure must not call ${method}`);
  const sender=f.ctx.agents.get(contactId),actor=f.policy.fromAgent(sender);
  sender.followup(createUserMessage({content:[{type:'text',text:'Configure the authorized ordinary Session'}],source:{kind:'v113-native-configure-test'}}));
  await sender.whenIdle();const configured=f.store.read().sessions[targetId];
  assert.equal(configured.state,'ready');assert.equal(configured.revision,2);assert.equal(configured.name,'Native ordinary renamed');
  assert.equal(configured.botId,null);assert.equal(configured.purpose,'ordinary');assert.equal(configured.configureOperationId,operationId);
  const agent=f.ctx.agents.get(targetId);assert.ok(agent);assert.notEqual(agent,handle.agent);
  const native=await f.adapter.inspectSession(targetId);assert.deepEqual(native.header,before.header);
  assert.equal(f.ctx.agentPresets.composedPreset(agent.ctx),'ordinary');assert.equal(f.ctx.sandboxPolicy.resolve({session:agent.session}).mode,'workspace-write');assert.equal(f.ctx.approval.effectivePolicy(agent.session),'ask');
  assert.equal(native.events.filter(event=>event.type==='session/title'&&event.data.title==='Native ordinary renamed').length,1);
  const request=command('session.configure',{sessionId:targetId,expectedVersion:1,name:'Native ordinary renamed'},operationId),receipt=structuredClone(f.store.read().operations[operationId]);
  assert.deepEqual(await f.ctx.agents.withInitiator(sender,()=>f.sessions.configure(actor,request)),configured);
  assert.deepEqual(f.store.read().operations[operationId],receipt);
  assert.equal((await f.adapter.inspectSession(targetId)).events.length,native.events.length);
  assert.equal(f.requests.filter(request=>request.sessionId===targetId).length,1);
  assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(),{provider:'controlled',model:'model-b'});
  for(const delegated of [false,true]){
    const id=crypto.randomUUID();await assert.rejects(f.ctx.agents.withInitiator(sender,()=>f.ctx.agents.create({sessionId:id,
      ...(delegated?{parentAgent:sender}:{}),meta:{cwd:f.dir,...(delegated?{parentSession:sender.id,origin:'subagent',delegationDepth:1}:{})},agentOptions:{provider:'controlled',model:'model-a'}})),{code:'work_admission_required'});
    assert.equal(f.ctx.agents.get(id),undefined);
  }
  await f.adapter.close();assert.equal(f.ctx.agents.get(targetId),agent);assert.equal(f.ctx.agents.get(contactId),undefined);
  await prompt(f,agent,'The ordinary Session survives plugin close');
  assert.equal(f.requests.filter(request=>request.sessionId===targetId).length,2);assert.equal(f.requests.at(-1).model,'model-a');
  assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(),{provider:'controlled',model:'model-b'});
});

for(const pending of [false,true])test(`accepted ordinary model configuration survives adapter close with native pending selection ${pending} and later native/reloaded changes win`,async t=>{
  const f=await fixture(t),handle=await ordinary(f),agent=handle.agent;
  if(pending)await f.ctx.sessionController.selectModel({sessionId:agent.id,provider:'controlled',model:'model-b'});
  const request=command('session.configure',{sessionId:agent.id,expectedVersion:1,model:{provider:'controlled',model:'model-a',maxTokens:17,temperature:0.3}},`ordinary-model-${pending}`);
  const configured=await f.sessions.configure(f.human,request);assert.equal(configured.state,'ready');assert.equal(configured.revision,2);
  const before=await f.adapter.inspectSession(agent.id),events=before.events.filter(event=>event.type==='model/selection');assert.equal(events.length,pending?2:1);
  assert.deepEqual(await f.sessions.configure(f.human,request),configured);assert.equal((await f.adapter.inspectSession(agent.id)).events.length,before.events.length);
  await prompt(f,agent,'Request before plugin close');assert.equal(f.requests.at(-1).model,'model-a');assert.equal(f.requests.at(-1).maxTokens,17);assert.equal(f.requests.at(-1).temperature,0.3);
  await f.adapter.close();assert.equal(f.ctx.agents.get(agent.id),agent);
  await prompt(f,agent,'Request after plugin close');assert.equal(f.requests.at(-1).model,'model-a');assert.equal(f.requests.at(-1).maxTokens,17);assert.equal(f.requests.at(-1).temperature,0.3);
  assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(),{provider:'controlled',model:'model-b'});
  await f.ctx.sessionController.selectModel({sessionId:agent.id,provider:'controlled',model:'model-c'});
  await prompt(f,agent,'Later native model selection wins');assert.equal(f.requests.at(-1).model,'model-c');
  const replacement=new NativeDshAdapter(f.ctx,{store:f.store,policy:f.policy});t.after(()=>replacement.close());
  const global=structuredClone(f.ctx.agentDefaultModel.currentSelection());
  const evidence=await replacement.configureOwned(f.store.read().sessions[agent.id],{model:{provider:'controlled',model:'model-a',maxTokens:23,temperature:0.2}});
  assert.equal(evidence.model.model,'model-a');
  await replacement.close();await prompt(f,agent,'Replacement plugin selection stays scoped');assert.equal(f.requests.at(-1).model,'model-a');assert.equal(f.requests.at(-1).maxTokens,23);assert.equal(f.requests.at(-1).temperature,0.2);
  assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(),global);assert.equal(f.requests.length,4);
  await handle.dispose();assert.equal(f.ctx.agents.get(agent.id),undefined);
  const resolved=await f.ctx.sessionController.resolveAgent(agent.id);assert.ok(resolved.agent);assert.notEqual(resolved.agent,agent);
  await prompt(f,resolved.agent,'Cold ordinary restores exact selected native model');assert.equal(f.requests.at(-1).model,'model-a');assert.equal(f.requests.length,5);
});

for(const cold of [false,true])test(`ordinary configuration never resumes or mutates a native subagent-owned target ${cold?'cold':'live'} with an exact Bot control grant`,async t=>{
  const f=await fixture(t),parent=await ordinary(f),id=crypto.randomUUID(),handle=await f.ctx.agents.create({sessionId:id,parentAgent:parent.agent,meta:childSessionMeta(parent.agent,1,false),agentOptions:{provider:'controlled',model:'model-b'}});
  handle.agent.followup(createUserMessage({content:[{type:'text',text:'Persist a subagent-owned native target'}],source:{kind:'v113-subagent-configure-test'}}));
  await handle.agent.whenIdle();await f.ctx.sessions.flush(handle.agent.session);if(cold)await handle.dispose();
  const bot=await f.bot(`SubagentConfigureSender-${cold}`),contact=await f.contact(bot),sender=f.ctx.agents.get(contact.sessionId),actor=f.policy.fromAgent(sender);
  await f.policy.authorizeShare(f.human,command('grant.set',{grantId:`subagent-exact-control-${cold}`,ownerBotId:null,recipientBotId:bot.botId,level:'control',scope:{sessions:[id]},active:true}));
  f.policy.require(actor,'session.configure',{kind:'session',id});
  const found=await f.ctx.sessionController.resolveAgent(id);assert.equal(found.error?.code,'session/agent-busy');
  await assert.rejects(f.ctx.agents.withInitiator(sender,()=>f.sessions.configure(actor,command('session.configure',{sessionId:id,expectedVersion:1,name:'Must not rename subagent'}))),error=>error.code==='session/agent-busy');
  assert.ok(cold?f.ctx.agents.get(id)===undefined:f.ctx.agents.get(id)===handle.agent);assert.equal(f.requests.length,1);
  const native=await f.adapter.inspectSession(id);assert.equal(native.events.some(event=>event.type==='session/title'&&event.data.title==='Must not rename subagent'),false);
  assert.equal(native.header.parentSession,parent.agent.id);assert.equal(f.ctx.agents.get(parent.agent.id),parent.agent);
});

test('human cold ordinary configuration keeps the resumed native Agent alive through adapter close',async t=>{
  const f=await fixture(t),handle=await ordinary(f);await prompt(f,handle.agent,'Persist ordinary ownership');const id=handle.agent.id;await handle.dispose();
  const configured=await f.sessions.configure(f.human,command('session.configure',{sessionId:id,expectedVersion:1,name:'Controller owned ordinary'}));assert.equal(configured.state,'ready');
  const agent=f.ctx.agents.get(id);assert.ok(agent);await f.adapter.close();assert.ok(f.ctx.agents.get(id)===agent,'ordinary Agent remains owned by its native controller');
  await prompt(f,agent,'Ordinary owner remains alive');assert.equal(f.requests.length,2);
});

test('active ordinary configuration reuses one scoped selection for same-route option changes and honors a later native model choice',async t=>{
  const f=await fixture(t),handle=await ordinary(f),agent=handle.agent;
  const first=await f.sessions.configure(f.human,command('session.configure',{sessionId:agent.id,expectedVersion:1,model:{provider:'controlled',model:'model-a',maxTokens:17,temperature:0.3}}));
  assert.equal(first.revision,2);await prompt(f,agent,'First explicit option selection');assert.equal(f.requests.at(-1).maxTokens,17);assert.equal(f.requests.at(-1).temperature,0.3);
  const next=await f.sessions.configure(f.human,command('session.configure',{sessionId:agent.id,expectedVersion:2,model:{provider:'controlled',model:'model-a',maxTokens:23,temperature:0.2}}));
  assert.equal(next.revision,3);
  await prompt(f,agent,'Reconfigured same route options');assert.equal(f.requests.at(-1).maxTokens,23);assert.equal(f.requests.at(-1).temperature,0.2);
  await f.ctx.sessionController.selectModel({sessionId:agent.id,provider:'controlled',model:'model-c'});
  await prompt(f,agent,'Later native choice while plugin is active');assert.equal(f.requests.at(-1).model,'model-c');
  assert.equal(f.requests.length,3);assert.equal((await f.adapter.inspectSession(agent.id)).events.filter(event=>event.type==='model/selection').length,3);
});

for(const boundary of ['abort','adapter-close'])test(`cold ordinary configuration stops before its title mutation after ${boundary} during actual native resume`,async t=>{
  const f=await fixture(t),handle=await ordinary(f),id=handle.agent.id;
  await prompt(f,handle.agent,'Persist a target for the native resume boundary');await handle.dispose();
  const entered=deferred(),release=deferred(),agents=f.ctx.agents,resume=agents.resume;
  agents.resume=async function(...args){const result=await resume.apply(this,args);entered.resolve();await release.promise;return result;};
  t.after(()=>{release.resolve();agents.resume=resume;});
  const signal=new AbortController(),request=command('session.configure',{sessionId:id,expectedVersion:1,name:'Must not cross native lifetime'},`ordinary-${boundary}-configure`);
  const pending=f.sessions.configure(f.human,request,signal.signal).then(result=>({result}),error=>({error}));
  await entered.promise;
  if(boundary==='abort')signal.abort();else await f.adapter.close();
  release.resolve();const outcome=await pending;
  assert.equal(outcome.result,undefined);assert.equal(boundary==='abort'?outcome.error?.name:outcome.error?.code,boundary==='abort'?'AbortError':'disposed');
  assert.equal(f.store.read().sessions[id].state,'UNKNOWN');
  const native=await f.adapter.inspectSession(id);assert.equal(native.events.some(event=>event.type==='session/title'&&event.data.title==='Must not cross native lifetime'),false);
  await assert.rejects(f.sessions.configure(f.human,request),{code:'session_outcome_unknown'});
  assert.equal((await f.adapter.inspectSession(id)).events.length,native.events.length);assert.equal(f.requests.length,1);
  assert.ok(f.ctx.agents.get(id),'the public controller retains ordinary Agent ownership');
});

for(const route of ['native','broker','rename','restart'])test(`accepted unconsumed ordinary full model options survive cold ${route} without native event or message replay`,async t=>{
  const directory=route==='restart'?await mkdtemp(join(tmpdir(),'v113-ordinary-restart-')):undefined;
  let f=await fixture(t,directory?{directory}:undefined);const initial=f,handle=await ordinary(f),id=handle.agent.id;
  const request=command('session.configure',{sessionId:id,expectedVersion:1,model:{provider:'controlled',model:'model-a',maxTokens:17,temperature:0.3}},`unconsumed-${route}`);
  const accepted=await f.sessions.configure(f.human,request),proof=structuredClone(accepted.nativeConfigEvidence),originalReceipt=structuredClone(f.store.read().operations[request.operationId]);
  assert.equal(f.requests.length,0);assert.equal(accepted.state,'ready');await handle.dispose();assert.equal(f.ctx.agents.get(id),undefined);
  if(route==='restart'){
    for(const close of f.beforeClose)await close();await f.adapter.close();await f.store.close();await f.close();
    f=await fixture(t,{directory});assert.equal(f.ctx.agents.get(id),undefined);assert.equal(f.requests.length,0);
    t.after(()=>rm(directory,{recursive:true,force:true}));
  }
  let agent;
  if(route==='rename'){
    const agents=f.ctx.agents,resume=agents.resume;let resumedHandle;
    agents.resume=async function(...args){const result=await resume.apply(this,args);if(result.agent.id===id)resumedHandle=result;return result;};
    t.after(()=>{agents.resume=resume;});
    const first=await f.sessions.configure(f.human,command('session.configure',{sessionId:id,expectedVersion:2,name:'First cold native title'}));
    assert.equal(first.nativeConfigEvidence.modelSeq,proof.modelSeq);assert.deepEqual(first.nativeConfigEvidence.model,proof.model);assert.equal(f.requests.length,0);
    await resumedHandle.dispose();assert.equal(f.ctx.agents.get(id),undefined);
    const second=await f.sessions.configure(f.human,command('session.configure',{sessionId:id,expectedVersion:3,name:'Second cold native title'}));
    assert.equal(second.nativeConfigEvidence.modelSeq,proof.modelSeq);assert.deepEqual(second.nativeConfigEvidence.model,proof.model);assert.equal(second.revision,4);assert.equal(f.requests.length,0);
    agent=f.ctx.agents.get(id);await prompt(f,agent,'First explicitly admitted native request after two cold titles');
  }else if(route==='broker'){
    const send=command('session.send',{sessionId:id,text:'First original cold broker message'},'unconsumed-cold-send'),row=await f.broker.enqueue(f.human,send);
    assert.equal(row.state,'accepted');agent=f.ctx.agents.get(id);await agent.whenIdle();await f.ctx.sessions.flush(agent.session);
    const history=await f.adapter.inspectSession(id),native=history.events.filter(event=>event.type==='user/message'&&event.data.source?.rpcId===row.message.id);assert.equal(native.length,1);assert.equal(native[0].data.id,row.message.id);
    assert.equal((await f.broker.enqueue(f.human,send)).message.id,row.message.id);
  }else{
    const found=await f.ctx.sessionController.resolveAgent(id);assert.ok(found.agent);agent=found.agent;assert.equal(f.requests.length,0);
    await prompt(f,agent,'First explicitly admitted cold native request');
  }
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].model,'model-a');assert.equal(f.requests[0].maxTokens,17);assert.equal(f.requests[0].temperature,0.3);
  assert.deepEqual(f.store.read().operations[request.operationId],originalReceipt);assert.deepEqual(f.ctx.agentDefaultModel.currentSelection(),{provider:'controlled',model:'model-b'});
  const history=await f.adapter.inspectSession(id);assert.equal(history.events.filter(event=>event.type==='model/selection').length,1);
  if(route==='restart')assert.equal(initial.requests.length,0);
});

for(const next of ['model-a','model-c'])test(`cold full model restoration rejects a newer native ${next} selection even before any request`,async t=>{
  const f=await fixture(t),handle=await ordinary(f),id=handle.agent.id;
  await f.sessions.configure(f.human,command('session.configure',{sessionId:id,expectedVersion:1,model:{provider:'controlled',model:'model-a',maxTokens:17,temperature:0.3}}));
  await f.ctx.sessionController.selectModel({sessionId:id,provider:'controlled',model:next});await f.ctx.sessions.flush(handle.agent.session);assert.equal(f.requests.length,0);await handle.dispose();
  const found=await f.ctx.sessionController.resolveAgent(id);assert.ok(found.agent);await prompt(f,found.agent,'Honor the newest explicit native model selection');
  assert.equal(f.requests[0].model,next);assert.notEqual(f.requests[0].maxTokens,17);assert.notEqual(f.requests[0].temperature,0.3);
  assert.equal((await f.adapter.inspectSession(id)).events.filter(event=>event.type==='model/selection').length,2);assert.equal(f.requests.length,1);
});

test('UNKNOWN ordinary configuration cannot restore full options or replay its original mutation on cold native activation',async t=>{
  const f=await fixture(t),handle=await ordinary(f),id=handle.agent.id,flush=f.ctx.sessions.flush;let selected=false;
  t.after(f.ctx.on('session/event',(session,event)=>{if(session.id===id&&event.type==='model/selection')selected=true;},{global:true}));
  f.ctx.sessions.flush=async function(session){await flush.call(this,session);if(session.id===id&&selected)throw Object.assign(Error('Controlled configuration acknowledgement loss'),{code:'v113_config_ack_lost'});};
  const request=command('session.configure',{sessionId:id,expectedVersion:1,model:{provider:'controlled',model:'model-a',maxTokens:17,temperature:0.3}},'unknown-full-selection');
  await assert.rejects(f.sessions.configure(f.human,request),{code:'v113_config_ack_lost'});f.ctx.sessions.flush=flush;
  const original=structuredClone(f.store.read());assert.equal(original.sessions[id].state,'UNKNOWN');assert.equal(f.requests.length,0);await handle.dispose();
  const found=await f.ctx.sessionController.resolveAgent(id);assert.ok(found.agent);assert.equal(f.requests.length,0);
  assert.deepEqual(f.store.read(),original);await assert.rejects(f.sessions.configure(f.human,request),{code:'session_outcome_unknown'});
  await prompt(f,found.agent,'Explicit native prompt with unproven configuration');assert.equal(f.requests.length,1);assert.notEqual(f.requests[0].maxTokens,17);assert.notEqual(f.requests[0].temperature,0.3);
  assert.equal((await f.adapter.inspectSession(id)).events.filter(event=>event.type==='model/selection').length,1);assert.deepEqual(f.store.read(),original);
});

test('v112 name-only evidence layout restores the exact older accepted ordinary model receipt without rewriting it',async t=>{
  const f=await fixture(t),handle=await ordinary(f),id=handle.agent.id;
  const modelRequest=command('session.configure',{sessionId:id,expectedVersion:1,model:{provider:'controlled',model:'model-a',maxTokens:17,temperature:0.3}},'legacy-ordinary-full-model');
  const accepted=await f.sessions.configure(f.human,modelRequest),original=structuredClone(f.store.read().operations[accepted.configureStatusId]);
  const configure=f.adapter.configureOwned.bind(f.adapter);
  // Reproduce the proven v112 result shape: name-only evidence replaces only the current evidence object.
  f.adapter.configureOwned=async(...args)=>{const evidence=await configure(...args);delete evidence.modelSeq;delete evidence.model;delete evidence.effective;return evidence;};
  const renamed=await f.sessions.configure(f.human,command('session.configure',{sessionId:id,expectedVersion:2,name:'Historical v112 native title'},'legacy-name-only'));
  f.adapter.configureOwned=configure;assert.equal(renamed.nativeConfigEvidence.modelSeq,undefined);assert.equal(renamed.modelSeq,accepted.modelSeq);assert.equal(f.requests.length,0);
  const before=structuredClone(f.store.read()),olderReceipt=before.operations[accepted.configureStatusId];assert.deepEqual(olderReceipt,original);
  await handle.dispose();const found=await f.ctx.sessionController.resolveAgent(id);assert.ok(found.agent);assert.equal(f.requests.length,0);assert.deepEqual(f.store.read(),before);
  await prompt(f,found.agent,'Explicit first request with accepted v112 ordinary settings');
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].model,'model-a');assert.equal(f.requests[0].maxTokens,17);assert.equal(f.requests[0].temperature,0.3);
  assert.deepEqual(f.store.read().operations[accepted.configureStatusId],olderReceipt);assert.deepEqual(f.store.read().operations[modelRequest.operationId],before.operations[modelRequest.operationId]);
  assert.equal((await f.adapter.inspectSession(id)).events.filter(event=>event.type==='model/selection').length,1);
});

test('cold ordinary full-option restoration requires an actual session.configured receipt action',async t=>{
  const f=await fixture(t),handle=await ordinary(f),id=handle.agent.id;
  await f.sessions.configure(f.human,command('session.configure',{sessionId:id,expectedVersion:1,model:{provider:'controlled',model:'model-a',maxTokens:17,temperature:0.3}},'malformed-model-proof'));
  // A malformed persisted status can have a matching result shape without recording configuration acceptance.
  await f.store.transact(command('fixture.malformed-status',{}),draft=>{
    for(const receipt of Object.values(draft.operations))if(receipt.action==='session.configured'&&receipt.result?.sessionId===id)receipt.action='fixture.unrelated-status';
    return null;
  });
  const before=structuredClone(f.store.read());await handle.dispose();const found=await f.ctx.sessionController.resolveAgent(id);assert.ok(found.agent);assert.equal(f.requests.length,0);assert.deepEqual(f.store.read(),before);
  await prompt(f,found.agent,'Explicit native prompt without a valid full-options receipt');
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].model,'model-a');assert.notEqual(f.requests[0].maxTokens,17);assert.notEqual(f.requests[0].temperature,0.3);
  assert.equal((await f.adapter.inspectSession(id)).events.filter(event=>event.type==='model/selection').length,1);assert.deepEqual(f.store.read(),before);
});
