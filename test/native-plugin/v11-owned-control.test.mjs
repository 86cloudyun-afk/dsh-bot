import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry';
import {businessFixture} from './business-fixture.mjs';
import {BotService} from '../../src/native/service.mjs';
import {deferred,eventually,textChunks} from './official-fixture.mjs';
const cmd=(action,input,operationId=crypto.randomUUID())=>({action,input,operationId});
const message=text=>createUserMessage({content:[{type:'text',text}],source:{kind:'owned-control-test'}});
async function contact(f,bot,input={}){return f.sessions.create(f.human,cmd('session.create',{botId:bot.botId,...input}));}
async function presets(f){await f.ctx.plugin(AgentPresets,{default:'alpha'});await f.ctx.agentPresets.register({id:'alpha',plugins:[]});await f.ctx.agentPresets.register({id:'beta',plugins:[]});}
async function reply(f,row,text='Historical source'){const agent=f.ctx.agents.get(row.sessionId);agent.followup(message(text));await eventually(()=>agent.status==='idle'&&f.events.get(agent.id)?.some(e=>e.type==='turn/end'));await f.ctx.sessions.flush(agent.session);}

test('v1.1 Bot updates its own configuration with CAS while cross-Bot updates remain denied',async t=>{
 const f=await businessFixture(t),a=await f.bot('A'),b=await f.bot('B'),row=await contact(f,a),actor=f.policy.fromAgent(f.ctx.agents.get(row.sessionId));
 const command=cmd('bot.update',{botId:a.botId,expectedVersion:a.revision,name:'Owned',contact:{provider:'controlled',model:'model-b'}});
 const saved=await f.bots.update(actor,command);assert.equal(saved.name,'Owned');assert.equal(saved.configRevision,a.configRevision+1);
 assert.deepEqual(await f.bots.update(actor,command),saved);
 await assert.rejects(f.bots.update(actor,cmd('bot.update',{botId:a.botId,expectedVersion:a.revision,name:'Stale'})),{code:'revision_conflict'});
 await assert.rejects(f.bots.update(actor,cmd('bot.update',{botId:b.botId,expectedVersion:b.revision,name:'Other'})),{code:'access_denied'});
 assert.equal(f.requests.length,0);
});

test('v1.1 validated Bot creation enters an existing transaction without extra writes',async t=>{
 const f=await businessFixture(t),before=f.store.read().revision,config=await f.bots.validateCreateConfig({name:'Template',cwd:f.dir,contact:{provider:'controlled',model:'model-a'}});
 assert.equal(f.store.read().revision,before);
 const bot=await f.store.transact(cmd('template.test',{}),draft=>f.bots.createValidatedInDraft(f.human,config,draft));
 assert.equal(bot.name,'Template');assert.equal(bot.revision,1);assert.equal(f.store.read().revision,before+1);
 await assert.rejects(f.store.transact(cmd('template.forgery',{}),draft=>f.bots.createValidatedInDraft(f.human,{...config},draft)),{code:'invalid_validated_config'});
});

test('v1.1 configured contact creation uses its target name/model/preset/cwd and original operation',async t=>{
 const f=await businessFixture(t);await presets(f);const bot=await f.bot(),command=cmd('session.create',{botId:bot.botId,name:'Configured',model:{provider:'controlled',model:'model-b'},presetId:'beta',cwd:f.dir});
 const row=await f.sessions.create(f.human,command);assert.deepEqual(await f.sessions.create(f.human,command),row);
 assert.equal(row.name,'Configured');assert.equal(row.model.model,'model-b');assert.equal(row.presetId,'beta');assert.equal(row.revision,1);
 const native=await f.adapter.readNative(row.sessionId);assert.equal(native.header.cwd,f.dir);assert.equal(native.header.agentPreset,'beta');assert.ok(native.events.some(e=>e.type==='session/title'&&e.data.title==='Configured'));
 await reply(f,row);assert.equal(f.requests[0].model,'model-b');assert.equal(f.store.read().bots[bot.botId].contact.model,'model-a');
});

test('v1.1 settled contact configure is CAS/idempotent and changes only target selection',async t=>{
 const f=await businessFixture(t),bot=await f.bot(),target=await contact(f,bot),other=await contact(f,bot);await reply(f,target);
 const actor=f.policy.fromAgent(f.ctx.agents.get(other.sessionId)),command=cmd('session.configure',{sessionId:target.sessionId,expectedVersion:target.revision??1,name:'Renamed',model:{provider:'controlled',model:'model-c'}});
 const row=await f.sessions.configure(actor,command);assert.equal(row.revision,2);assert.equal(row.name,'Renamed');assert.equal(row.model.model,'model-c');assert.deepEqual(await f.sessions.configure(actor,command),row);
 await assert.rejects(f.sessions.configure(actor,cmd('session.configure',{sessionId:row.sessionId,expectedVersion:1,name:'Stale'})),{code:'revision_conflict'});
 await reply(f,row,'Next model');await reply(f,other);assert.equal(f.requests.filter(r=>r.sessionId===row.sessionId).at(-1).model,'model-c');assert.equal(f.requests.filter(r=>r.sessionId===other.sessionId).at(-1).model,'model-a');
 const history=await f.adapter.readNative(row.sessionId);assert.ok(history.events.some(e=>e.type==='model/selection'&&e.data.model==='model-c'));assert.ok(history.events.some(e=>e.type==='user/message'&&e.data.source?.kind==='model-selection'));
});

test('v1.1 native preset is mutable while blank and locked after the first real turn',async t=>{
 const f=await businessFixture(t);await presets(f);const bot=await f.bot(),row=await contact(f,bot);
 const configured=await f.sessions.configure(f.human,cmd('session.configure',{sessionId:row.sessionId,expectedVersion:1,presetId:'beta'}));assert.equal(configured.presetId,'beta');assert.equal(f.ctx.agentPresets.composedPreset(f.ctx.agents.get(row.sessionId).ctx),'beta');
 await reply(f,configured);const before=f.store.read();await assert.rejects(f.sessions.configure(f.human,cmd('session.configure',{sessionId:row.sessionId,expectedVersion:2,presetId:'alpha'})),error=>error.code==='agent-preset/locked'||error.code==='preset_locked');assert.deepEqual(f.store.read(),before);
});

test('v1.1 configure rejects active replies, native inboxes and fixed cwd before writing',async t=>{
 const entered=deferred(),release=deferred();t.after(()=>release.resolve());const f=await businessFixture(t,{stream:async function*(options){entered.resolve();await release.promise;yield* textChunks('done');}});
 const bot=await f.bot(),row=await contact(f,bot),agent=f.ctx.agents.get(row.sessionId);agent.followup(message('Active'));await entered.promise;
 const before=f.store.read();await assert.rejects(f.sessions.configure(f.human,cmd('session.configure',{sessionId:row.sessionId,expectedVersion:1,model:{provider:'controlled',model:'model-b'}})),{code:'session_active'});assert.deepEqual(f.store.read(),before);
 release.resolve();await eventually(()=>agent.status==='idle');
 await assert.rejects(f.sessions.configure(f.human,cmd('session.configure',{sessionId:row.sessionId,expectedVersion:1,cwd:await mkdir(`${f.dir}/other`,{recursive:true}).then(()=>`${f.dir}/other`)})),{code:'cwd_immutable'});
 agent.inbox.append('next-turn',message('Queued'));const queued=f.store.read();await assert.rejects(f.sessions.configure(f.human,cmd('session.configure',{sessionId:row.sessionId,expectedVersion:1,name:'Queued'})),{code:'session_active'});assert.deepEqual(f.store.read(),queued);
});

test('v1.1 fork preserves a verifiable native prefix, source IDs and configured contact behavior',async t=>{
 const f=await businessFixture(t),bot=await f.bot(),source=await contact(f,bot);await reply(f,source,'Original historical marker');const history=await f.adapter.readNative(source.sessionId),atSeq=history.events.findLast(e=>e.type==='turn/end').seq;
 const command=cmd('session.fork',{sessionId:source.sessionId,atSeq,name:'Continuation',model:{provider:'controlled',model:'model-b'},cwd:f.dir});const row=await f.sessions.fork(f.human,command);assert.deepEqual(await f.sessions.fork(f.human,command),row);
 assert.notEqual(row.sessionId,source.sessionId);assert.equal(row.source.sessionId,source.sessionId);assert.equal(row.source.eventSeq,atSeq);assert.match(row.source.checksum,/^[a-f0-9]{64}$/);assert.ok(row.origins.some(ref=>ref.kind==='session'&&ref.id===source.sessionId));
 const forked=await f.adapter.readNative(row.sessionId);assert.deepEqual(forked.events.slice(0,atSeq+1),history.events.slice(0,atSeq+1));assert.equal(forked.header.parentSession,source.sessionId);assert.equal(f.ctx.agents.get(row.sessionId).session.inheritedEventCount,atSeq+1);assert.equal(forked.header.isSeeded,true);
 await reply(f,row,'Continue with history');assert.equal(f.requests.at(-1).model,'model-b');assert.ok(JSON.stringify(f.requests.at(-1).messages).includes('Original historical marker'));assert.deepEqual((await f.adapter.readNative(source.sessionId)).events,history.events);
 assert.equal(Object.keys(f.store.read().attempts).length,0);
});

test('v1.1 fork checks source access and native boundary before writing or model calls',async t=>{
 const f=await businessFixture(t),bot=await f.bot(),source=await contact(f,bot),before=f.store.read();
 await assert.rejects(f.sessions.fork(f.human,cmd('session.fork',{sessionId:source.sessionId,atSeq:999})),{code:'fork_unavailable'});assert.deepEqual(f.store.read(),before);assert.equal(f.requests.length,0);
});

test('v1.1 context provider receives accepted pre-step messages without extra model calls',async t=>{
 const f=await businessFixture(t),bot=await f.bot(),row=await contact(f,bot),seen=[];f.adapter.setContextProvider((_agent,_binding,input)=>{seen.push(input);return 'Owned context';});await reply(f,row,'Find this query');
 assert.ok(seen[0]?.messages?.some(m=>m.content?.some(b=>b.text==='Find this query')));assert.equal(f.requests.length,1);
});

test('v1.1 self-pause publishes its exact Bot receipt and blocks subsequent native tools/model requests',async t=>{
 const f=await businessFixture(t);f.service=new BotService(f);f.adapter.setService(f.service);const bot=await f.bot(),row=await contact(f,bot),agent=f.ctx.agents.get(row.sessionId),command=cmd('bot.update',{botId:bot.botId,expectedVersion:bot.revision,lifecycle:'paused'});
 const result=await f.ctx.tools.execute({callId:'pause',name:'dsh_bot',agent,signal:new AbortController().signal,arguments:command});assert.equal(result.isError,false,JSON.stringify(result));assert.ok(JSON.stringify(result.content).includes('paused'));assert.equal(f.store.read().bots[bot.botId].lifecycle,'paused');
 const next=await f.ctx.tools.execute({callId:'after-pause',name:'dsh_bot',agent,signal:new AbortController().signal,arguments:{action:'snapshot'}});assert.equal(next.isError,true);agent.followup(message('No next model'));await eventually(()=>agent.status==='idle');assert.equal(f.requests.length,0);
});

test('v1.1 exact ordinary-session grant configures native title/model without adopting Bot identity',async t=>{
 const f=await businessFixture(t),bot=await f.bot(),own=await contact(f,bot),actor=f.policy.fromAgent(f.ctx.agents.get(own.sessionId)),handle=await f.ctx.agents.create({sessionId:'ordinary-configured',meta:{cwd:f.dir},agentOptions:{provider:'controlled',model:'model-a'}});f.beforeClose.push(()=>handle.dispose());await f.ctx.sessions.flush(handle.agent.session);
 const command=cmd('session.configure',{sessionId:handle.agent.id,expectedVersion:1,name:'Ordinary target',model:{provider:'controlled',model:'model-b'}});
 await assert.rejects(f.sessions.configure(actor,command),{code:'access_denied'});
 const grant={grantId:'ordinary-config',ownerBotId:null,recipientBotId:bot.botId,scope:{sessions:[handle.agent.id]},level:'control',active:true};await f.policy.authorizeShare(f.human,cmd('grant.set',grant));
 const row=await f.sessions.configure(actor,command);assert.equal(row.botId,null);assert.equal(row.purpose,'ordinary');await assert.rejects(Promise.resolve().then(()=>f.policy.fromAgent(handle.agent)),{code:'access_denied'});
 await reply(f,row,'Ordinary next model');assert.equal(f.requests.at(-1).model,'model-b');
 await f.policy.authorizeShare(f.human,cmd('grant.set',{...grant,active:false}));await assert.rejects(f.sessions.configure(actor,command),{code:'access_denied'});
});

test('v1.1 fork retains actual selected native preset and full history across cold resume',async t=>{
 const f=await businessFixture(t);await presets(f);const bot=await f.bot(),source=await contact(f,bot),selected=await f.sessions.configure(f.human,cmd('session.configure',{sessionId:source.sessionId,expectedVersion:1,presetId:'beta'}));await reply(f,selected);
 const before=f.store.read();await assert.rejects(f.sessions.fork(f.human,cmd('session.fork',{sessionId:source.sessionId,presetId:'alpha'})),{code:'fork_preset_immutable'});assert.deepEqual(f.store.read(),before);
 const history=await f.adapter.readNative(source.sessionId),row=await f.sessions.fork(f.human,cmd('session.fork',{sessionId:source.sessionId}));assert.equal(row.presetId,'beta');assert.equal(f.ctx.sessionProjections.stateOf(f.ctx.agents.get(row.sessionId).session,'agentPreset'),'beta');assert.deepEqual((await f.adapter.readNative(row.sessionId)).events.slice(0,row.source.eventSeq+1),history.events.slice(0,row.source.eventSeq+1));
 await f.adapter.disposeOwned(row.sessionId);await f.adapter.resumeOwned(row);assert.equal(f.ctx.agentPresets.composedPreset(f.ctx.agents.get(row.sessionId).ctx),'beta');await reply(f,row,'Resumed native fork');
});

test('v1.1 lost native configure receipt preserves UNKNOWN, native evidence and original operation',async t=>{
 const f=await businessFixture(t),bot=await f.bot(),row=await contact(f,bot),command=cmd('session.configure',{sessionId:row.sessionId,expectedVersion:1,name:'Applied before loss',model:{provider:'controlled',model:'model-c'}}),apply=f.adapter.configureOwned.bind(f.adapter);let calls=0;
 f.adapter.configureOwned=async(...args)=>{calls++;const evidence=await apply(...args);throw Object.assign(Error('lost native receipt'),{code:'fixture_lost_receipt',details:{nativeConfigEvidence:evidence}});};
 await assert.rejects(f.sessions.configure(f.human,command),{code:'fixture_lost_receipt'});const saved=f.store.read().sessions[row.sessionId];assert.equal(saved.state,'UNKNOWN');assert.equal(saved.nativeConfigEvidence.name,'Applied before loss');assert.equal(saved.configureOperationId,command.operationId);
 await assert.rejects(f.sessions.configure(f.human,command),{code:'session_outcome_unknown'});assert.equal(calls,1);assert.equal(Object.keys(f.store.read().sessions).length,1);
});

test('v1.1 lost native fork receipt keeps original native ID and never substitutes a retry',async t=>{
 const f=await businessFixture(t),bot=await f.bot(),source=await contact(f,bot);await reply(f,source);const command=cmd('session.fork',{sessionId:source.sessionId}),create=f.adapter.createOwned.bind(f.adapter);let calls=0;
 f.adapter.createOwned=async(...args)=>{calls++;await create(...args);throw Object.assign(Error('lost native creation receipt'),{code:'fixture_lost_receipt'});};
 await assert.rejects(f.sessions.fork(f.human,command),{code:'fixture_lost_receipt'});const intent=f.store.read().operations[command.operationId].result;assert.equal(f.store.read().sessions[intent.sessionId].state,'UNKNOWN');assert.ok(f.ctx.agents.get(intent.sessionId));
 await assert.rejects(f.sessions.fork(f.human,command),{code:'session_outcome_unknown'});assert.equal(calls,1);assert.equal(Object.keys(f.store.read().sessions).length,2);
});

test('v1.1 granted ordinary title/model remains native after cold management without identity adoption',async t=>{
 const f=await businessFixture(t),bot=await f.bot(),own=await contact(f,bot),actor=f.policy.fromAgent(f.ctx.agents.get(own.sessionId)),handle=await f.ctx.agents.create({sessionId:'cold-ordinary-config',meta:{cwd:f.dir},agentOptions:{provider:'controlled',model:'model-a'}});await f.ctx.sessions.flush(handle.agent.session);await handle.dispose();
 await f.policy.authorizeShare(f.human,cmd('grant.set',{grantId:'cold-control',ownerBotId:null,recipientBotId:bot.botId,scope:{sessions:['cold-ordinary-config']},level:'control',active:true}));
 const row=await f.sessions.configure(actor,cmd('session.configure',{sessionId:'cold-ordinary-config',expectedVersion:1,name:'Cold native title',model:{provider:'controlled',model:'model-c'}}));assert.equal(row.botId,null);assert.equal(f.ctx.agents.get(row.sessionId).session.header.id,'cold-ordinary-config');await reply(f,row,'Cold ordinary request');assert.equal(f.requests.at(-1).model,'model-c');
 await f.adapter.disposeOwned(row.sessionId);const renamed=await f.sessions.configure(actor,cmd('session.configure',{sessionId:row.sessionId,expectedVersion:2,name:'Again cold'}));assert.equal(renamed.revision,3);await reply(f,renamed,'Cold retained model');assert.equal(f.requests.at(-1).model,'model-c');
});

test('v1.1 create/fork replay retains original committed receipt after a later configuration',async t=>{
 const f=await businessFixture(t),bot=await f.bot(),create=cmd('session.create',{botId:bot.botId}),original=await f.sessions.create(f.human,create);await f.sessions.configure(f.human,cmd('session.configure',{sessionId:original.sessionId,expectedVersion:1,name:'Later title'}));assert.deepEqual(await f.sessions.create(f.human,create),original);
 await reply(f,original);const fork=cmd('session.fork',{sessionId:original.sessionId}),forked=await f.sessions.fork(f.human,fork);await f.sessions.configure(f.human,cmd('session.configure',{sessionId:forked.sessionId,expectedVersion:1,name:'Later fork title'}));assert.deepEqual(await f.sessions.fork(f.human,fork),forked);
});

function nativeBarrierTool(f,t,entered,release,name='owned-review-resource') {
 t.after(f.ctx.tools.register({name,description:'Controlled native resource barrier',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'boolean'},render:()=>[{type:'text',text:'done'}]},execute:async()=>{entered.resolve();await release.promise;return true;}}));
}
async function ordinary(f,id) {const handle=await f.ctx.agents.create({sessionId:id,meta:{cwd:f.dir},agentOptions:{provider:'controlled',model:'model-a'}});f.beforeClose.push(()=>handle.dispose());await f.ctx.sessions.flush(handle.agent.session);return handle.agent;}
const nativeTool=(f,agent,name)=>f.ctx.tools.execute({callId:crypto.randomUUID(),name,agent,signal:new AbortController().signal,arguments:{}});

test('review P1: ordinary active native tool blocks configure before writing even when Agent is idle',async t=>{
 const entered=deferred(),release=deferred();t.after(()=>release.resolve());const f=await businessFixture(t),agent=await ordinary(f,'ordinary-active-native-tool');nativeBarrierTool(f,t,entered,release);
 const running=nativeTool(f,agent,'owned-review-resource');await entered.promise;assert.equal(agent.status,'idle');const before=f.store.read();
 await assert.rejects(f.sessions.configure(f.human,cmd('session.configure',{sessionId:agent.id,expectedVersion:1,name:'Must wait'})),{code:'session_active'});assert.deepEqual(f.store.read(),before);
 release.resolve();assert.equal((await running).isError,false);assert.equal(f.requests.length,0);
});

test('review P1: ordinary configuration intent fences new native tools and model work',async t=>{
 const entered=deferred(),release=deferred();t.after(()=>release.resolve());const f=await businessFixture(t),agent=await ordinary(f,'ordinary-fenced-native-tool'),apply=f.adapter.configureOwned.bind(f.adapter);let calls=0;
 t.after(f.ctx.tools.register({name:'owned-review-quick-tool',description:'Count a harmless native call',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'boolean'},render:()=>[{type:'text',text:'done'}]},execute:async()=>{calls++;return true;}}));
 f.adapter.configureOwned=async(...args)=>{entered.resolve();await release.promise;return apply(...args);};
 const pending=f.sessions.configure(f.human,cmd('session.configure',{sessionId:agent.id,expectedVersion:1,name:'Fenced configure'}));await entered.promise;assert.equal(f.store.read().sessions[agent.id].state,'configuring');
 const result=await nativeTool(f,agent,'owned-review-quick-tool');assert.equal(result.isError,true);assert.equal(calls,0);
 agent.followup(message('Fenced native model request'));await agent.whenIdle();assert.equal(f.requests.length,0);release.resolve();assert.equal((await pending).state,'ready');
});

test('review P2: fork exact historical prefix retains the prefix effective native preset across cold resume',async t=>{
 const f=await businessFixture(t);await presets(f);const bot=await f.bot(),source=await contact(f,bot),beta=await f.sessions.configure(f.human,cmd('session.configure',{sessionId:source.sessionId,expectedVersion:1,presetId:'beta'}));
 const cut=beta.nativeConfigEvidence.presetSeq;await f.sessions.configure(f.human,cmd('session.configure',{sessionId:source.sessionId,expectedVersion:2,presetId:'alpha'}));
 const history=await f.adapter.readNative(source.sessionId),row=await f.sessions.fork(f.human,cmd('session.fork',{sessionId:source.sessionId,atSeq:cut}));assert.equal(row.presetId,'beta');
 assert.equal(f.ctx.agentPresets.composedPreset(f.ctx.agents.get(row.sessionId).ctx),'beta');assert.equal(f.ctx.sessionProjections.stateOf(f.ctx.agents.get(row.sessionId).session,'agentPreset'),'beta');assert.deepEqual((await f.adapter.readNative(row.sessionId)).events.slice(0,cut+1),history.events.slice(0,cut+1));
 await f.adapter.disposeOwned(row.sessionId);await f.adapter.resumeOwned(row);assert.equal(f.ctx.agentPresets.composedPreset(f.ctx.agents.get(row.sessionId).ctx),'beta');assert.equal(f.requests.length,0);
});

test('review P2: configure applies against actual externally selected native preset for live and cold targets',async t=>{
 for(const cold of [false,true]) {
  const f=await businessFixture(t);await presets(f);const bot=await f.bot(cold?'ColdNativePreset':'LiveNativePreset'),row=await contact(f,bot),agent=f.ctx.agents.get(row.sessionId);
  await f.ctx.agentPresets.select(agent,'beta');await f.ctx.sessions.flush(agent.session);assert.equal(f.store.read().sessions[row.sessionId].presetId,'alpha');if(cold)await f.adapter.disposeOwned(row.sessionId);
  const configured=await f.sessions.configure(f.human,cmd('session.configure',{sessionId:row.sessionId,expectedVersion:1,presetId:'alpha'}));assert.equal(configured.presetId,'alpha');assert.equal(configured.nativeConfigEvidence.presetId,'alpha');
  assert.equal(f.ctx.agentPresets.composedPreset(f.ctx.agents.get(row.sessionId).ctx),'alpha');assert.equal(f.ctx.sessionProjections.stateOf(f.ctx.agents.get(row.sessionId).session,'agentPreset'),'alpha');assert.equal(f.requests.length,0);
 }
});

test('review P1: native tool waiting on a public admission gate remains a live resource',async t=>{
 const entered=deferred(),release=deferred();t.after(()=>release.resolve());const f=await businessFixture(t),agent=await ordinary(f,'ordinary-native-gate');let calls=0;
 t.after(f.ctx.tools.register({name:'owned-review-gated-tool',description:'Harmless native gated tool',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'boolean'},render:()=>[{type:'text',text:'done'}]},execute:async()=>{calls++;return true;}}));
 t.after(f.ctx.on('tools/pre-execute',async(exec,next)=>{if(exec.name==='owned-review-gated-tool'){entered.resolve();await release.promise;}return next();},{global:true}));
 const pending=nativeTool(f,agent,'owned-review-gated-tool');await entered.promise;const before=f.store.read();await assert.rejects(f.sessions.configure(f.human,cmd('session.configure',{sessionId:agent.id,expectedVersion:1,name:'Must await native gate'})),{code:'session_active'});assert.deepEqual(f.store.read(),before);release.resolve();assert.equal((await pending).isError,false);assert.equal(calls,1);assert.equal(f.adapter.resources(agent.id).settled,true);
});
