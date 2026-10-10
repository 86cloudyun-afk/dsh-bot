import test from 'node:test';
import assert from 'node:assert/strict';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {businessFixture} from './business-fixture.mjs';
import {createOfficialFixture,deferred,eventually} from './official-fixture.mjs';
import {NativeDshAdapter} from '../../src/native/adapter.mjs';
import {SessionOwnership} from '../../src/native/sessions.mjs';
import * as Plugin from '../../src/native/plugin.mjs';
const command=(action,input,operationId=crypto.randomUUID())=>({operationId,action,input});
const tool=(f,agent,name)=>f.ctx.tools.execute({callId:crypto.randomUUID(),name,agent,signal:new AbortController().signal,arguments:{}});

for(const resumedBeforeUnload of [true,false])test(`plugin reload binds a live externally owned contact resumed ${resumedBeforeUnload?'before unload':'while disabled'}`,async t=>{
  const f=await createOfficialFixture(),operator={};let plugin,external;
  f.ctx.provide('profileContext',{name:'v112-live-contact',dir:f.dir});f.ctx.provide('webServer',{});f.ctx.provide('connection',{operator,fetch:{register(){return()=>{};}}});
  t.after(async()=>{await plugin?.dispose();await external?.dispose();await f.close();});
  plugin=f.ctx.plugin(Plugin);await plugin.await();let service=f.ctx.get('dshBot'),human=service.policy.fromPeer(operator);
  const bot=await service.dispatch(human,command('bot.create',{name:'Live contact',cwd:f.dir,contact:{provider:'controlled',model:'model-a'}}));
  const row=await service.dispatch(human,command('session.create',{botId:bot.botId}));await service.adapter.disposeOwned(row.sessionId);
  if(resumedBeforeUnload)external=await f.ctx.agents.resume({resumeSessionId:row.sessionId,agentOptions:{provider:'controlled',model:'model-a'}});
  await plugin.dispose();plugin=null;
  if(!resumedBeforeUnload)external=await f.ctx.agents.resume({resumeSessionId:row.sessionId,agentOptions:{provider:'controlled',model:'model-a'}});
  const originals=[row.operationId,row.statusOperationId].map(id=>[id,service.store.read().operations[id]]),messages=[];
  for(let cycle=1;cycle<=3;cycle++) {
    plugin=f.ctx.plugin(Plugin);await plugin.await();service=f.ctx.get('dshBot');human=service.policy.fromPeer(operator);
    assert.equal(f.ctx.agents.get(row.sessionId),external.agent);assert.equal(service.store.read().sessions[row.sessionId].state,'ready');
    assert.equal(service.adapter.resources(row.sessionId).known,false,'binding cannot prove preexisting activity idle');
    assert.equal(f.requests.length,cycle-1,'reload must not replay input or submit an extra request');
    const message=createUserMessage({content:[{type:'text',text:`A reply after plugin reload ${cycle}`}],source:{kind:'v112-lifecycle'}});messages.push(message);
    external.agent.followup(message);await external.agent.whenIdle();
    assert.equal(f.requests.length,cycle);assert.equal(f.ctx.tools.schemas(external.agent).some(schema=>schema.name==='dsh_bot'),true);
    assert.equal(f.events.get(row.sessionId).filter(event=>event.type==='assistant/message'&&event.data.message.content.some(part=>part.type==='text'&&part.text==='Native test reply')).length,cycle);
    await assert.rejects(service.dispatch(human,command('session.configure',{sessionId:row.sessionId,expectedVersion:1,name:'Unknown preexisting resources'})),{code:'resource_identity_unknown'});
    await assert.rejects(service.dispatch(human,command('session.archive',{sessionId:row.sessionId})),{code:'resource_identity_unknown'});
    for(const [id,receipt] of originals)assert.deepEqual(service.store.read().operations[id],receipt);
    if(cycle<3) {await plugin.dispose();plugin=null;assert.equal(f.ctx.agents.get(row.sessionId),external.agent);assert.equal(f.requests.length,cycle);}
  }
  const events=(await service.adapter.readNative(row.sessionId)).events;
  for(const message of messages)assert.equal(events.filter(event=>event.type==='user/message'&&event.data.id===message.id).length,1);
  await external.dispose();external=null;
  const fresh=await service.adapter.resumeOwned(service.store.read().sessions[row.sessionId]);assert.equal(service.adapter.resources(row.sessionId).known,true,'fresh official Agent identity clears the historical unknown marker');
  const renamed=await service.dispatch(human,command('session.configure',{sessionId:row.sessionId,expectedVersion:1,name:'Fresh known identity'}));assert.equal(renamed.state,'ready');assert.equal(f.ctx.agents.get(row.sessionId),fresh);
});

for(const externalUnknown of [false,true])test(`shutdown preserves UNKNOWN for an actually tracked unsettled ${externalUnknown?'preexisting external':'plugin-owned'} contact tool`,async t=>{
  const f=await businessFixture(t),bot=await f.bot(),row=await f.sessions.create(f.human,command('session.create',{botId:bot.botId}));let adapter=f.adapter,external;
  if(externalUnknown) {
    await adapter.disposeOwned(row.sessionId);await adapter.close();
    external=await f.ctx.agents.resume({resumeSessionId:row.sessionId,agentOptions:{provider:'controlled',model:'model-a'}});f.beforeClose.push(()=>external.dispose());
    adapter=new NativeDshAdapter(f.ctx,{store:f.store,policy:f.policy});f.beforeClose.push(()=>adapter.close());await adapter.start();
  }
  const agent=f.ctx.agents.get(row.sessionId),entered=deferred(),release=deferred();t.after(()=>release.resolve());
  t.after(f.ctx.tools.register({name:'v112_held_shutdown_tool',description:'Hold a controlled native producer',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'boolean'},render:()=>[{type:'text',text:'done'}]},execute:async()=>{entered.resolve();await release.promise;return true;}}));
  const pending=tool(f,agent,'v112_held_shutdown_tool');await entered.promise;
  assert.equal(adapter.resources(row.sessionId).known,!externalUnknown);assert.equal(adapter.resources(row.sessionId).tools,1);
  await adapter.close();
  const saved=f.store.read().sessions[row.sessionId];assert.equal(saved.state,'UNKNOWN');assert.equal(saved.error,'shutdown_resources_unsettled');assert.equal(saved.resourceEvidence.tools,1);
  assert.equal(f.requests.length,0);release.resolve();await pending;
});

test('shutdown preserves UNKNOWN for a preexisting external contact with a lost native stop receipt',async t=>{
  const f=await coldContact(t);await f.adapter.close();
  const external=await f.ctx.agents.resume({resumeSessionId:f.row.sessionId,agentOptions:{provider:'controlled',model:'model-a'}});f.beforeClose.push(()=>external.dispose());
  const adapter=new NativeDshAdapter(f.ctx,{store:f.store,policy:f.policy});f.beforeClose.push(()=>adapter.close());await adapter.start();
  const cancel=external.agent.cancel.bind(external.agent);external.agent.cancel=()=>{throw Object.assign(Error('Controlled lost native stop receipt'),{code:'v112_stop_receipt_lost'});};
  try {await adapter.close();}finally{external.agent.cancel=cancel;}
  const saved=f.store.read().sessions[f.row.sessionId];assert.equal(saved.state,'UNKNOWN');assert.equal(saved.error,'shutdown_resources_unsettled');assert.equal(saved.resourceEvidence.known,false);
  assert.ok(saved.resourceEvidence.resourceFaults.some(fault=>fault.error==='v112_stop_receipt_lost'));assert.equal(f.ctx.agents.get(f.row.sessionId),external.agent);assert.equal(f.requests.length,0);
});

for(const action of ['archive','restore'])test(`${action} fences new ordinary native tools while its accepted intent awaits native completion`,async t=>{
  const f=await businessFixture(t),handle=await f.ctx.agents.create({sessionId:`ordinary-${action}-fence`,meta:{cwd:f.dir},agentOptions:{provider:'controlled',model:'model-a'}});f.beforeClose.push(()=>handle.dispose());await f.ctx.sessions.flush(handle.agent.session);
  if(action==='restore')await f.sessions.archive(f.human,command('session.archive',{sessionId:handle.agent.id}));
  const registry=f.ctx.workspaceRegistry,method=action==='archive'?'archiveSession':'unarchiveSession',native=registry[method].bind(registry),entered=deferred(),release=deferred();t.after(()=>release.resolve());
  registry[method]=async(...args)=>{entered.resolve();await release.promise;return native(...args);};let calls=0;
  t.after(f.ctx.tools.register({name:`v112_${action}_tool`,description:'Count a harmless native call',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'boolean'},render:()=>[{type:'text',text:'done'}]},execute:async()=>{calls++;return true;}}));
  const op=command(`session.${action}`,{sessionId:handle.agent.id}),pending=f.sessions[action](f.human,op);await entered.promise;
  try {assert.equal((await tool(f,handle.agent,`v112_${action}_tool`)).isError,true);assert.equal(calls,0);}finally{release.resolve();}
  const receipt=await pending;assert.equal(receipt.archived,action==='archive');assert.deepEqual(await f.sessions[action](f.human,op),receipt);
  assert.equal((await tool(f,handle.agent,`v112_${action}_tool`)).isError,false,'accepted intent releases its fence after native settlement');assert.equal(calls,1);
});

test('archive rejects unknowable preexisting native activity, while genuine cold ordinary and contact sessions stay archivable',async t=>{
  const f=await businessFixture(t),bot=await f.bot(),row=await f.sessions.create(f.human,command('session.create',{botId:bot.botId}));await f.adapter.disposeOwned(row.sessionId);await f.adapter.close();
  const handle=await f.ctx.agents.create({sessionId:'preexisting-ordinary',meta:{cwd:f.dir},agentOptions:{provider:'controlled',model:'model-a'}});f.beforeClose.push(()=>handle.dispose());await f.ctx.sessions.flush(handle.agent.session);
  const adapter=new NativeDshAdapter(f.ctx,{store:f.store,policy:f.policy}),sessions=new SessionOwnership(f.store,f.policy,adapter);f.beforeClose.push(()=>adapter.close());
  assert.equal(adapter.resources(handle.agent.id).known,false);
  const before=f.store.read();await assert.rejects(sessions.archive(f.human,command('session.archive',{sessionId:handle.agent.id})),{code:'resource_identity_unknown'});assert.deepEqual(f.store.read(),before);
  await handle.dispose();const cold=new NativeDshAdapter(f.ctx,{store:f.store,policy:f.policy}),coldSessions=new SessionOwnership(f.store,f.policy,cold);f.beforeClose.push(()=>cold.close());
  for(const id of [handle.agent.id,row.sessionId]) {assert.equal(cold.resources(id).known,true);assert.equal((await coldSessions.archive(f.human,command('session.archive',{sessionId:id}))).archived,true);}
});

async function coldContact(t) {
  const f=await businessFixture(t),bot=await f.bot(),row=await f.sessions.create(f.human,command('session.create',{botId:bot.botId}));await f.adapter.disposeOwned(row.sessionId);return {...f,row};
}
test('simultaneous cold contact resumes share one official write handle and exact Agent',async t=>{
  const f=await coldContact(t),inspect=f.adapter.inspectSession.bind(f.adapter),resume=f.ctx.agents.resume.bind(f.ctx.agents),entered=deferred(),release=deferred();t.after(()=>release.resolve());let inspections=0,resumes=0;
  f.adapter.inspectSession=async(...args)=>{inspections++;const history=await inspect(...args);entered.resolve();await release.promise;return history;};f.ctx.agents.resume=async(...args)=>{resumes++;return resume(...args);};
  const first=f.adapter.resumeOwned(f.row);await entered.promise;const second=f.adapter.resumeOwned(f.row);release.resolve();
  const results=await Promise.allSettled([first,second]);assert.deepEqual(results.map(result=>result.status),['fulfilled','fulfilled']);assert.equal(results[0].value,results[1].value);assert.equal(f.ctx.agents.get(f.row.sessionId),results[0].value);assert.equal(inspections,1);assert.equal(resumes,1);assert.equal(f.requests.length,0);
});

test('a failed cold inspection clears the shared resume entry for a later actual resume',async t=>{
  const f=await coldContact(t),inspect=f.adapter.inspectSession.bind(f.adapter);let inspections=0;
  f.adapter.inspectSession=async(...args)=>{if(++inspections===1)throw Object.assign(Error('Controlled native read failure'),{code:'audit_native_read_failed'});return inspect(...args);};
  await assert.rejects(f.adapter.resumeOwned(f.row),{code:'audit_native_read_failed'});const agent=await f.adapter.resumeOwned(f.row);assert.equal(f.ctx.agents.get(f.row.sessionId),agent);assert.equal(inspections,2);assert.equal(f.requests.length,0);
});

test('cold resume rechecks a newly published external Agent after its native inspection',async t=>{
  const f=await coldContact(t),inspect=f.adapter.inspectSession.bind(f.adapter),entered=deferred(),release=deferred();t.after(()=>release.resolve());
  f.adapter.inspectSession=async(...args)=>{const history=await inspect(...args);entered.resolve();await release.promise;return history;};
  const pending=f.adapter.resumeOwned(f.row).then(value=>({value}),error=>({error}));await entered.promise;
  const external=await f.ctx.agents.resume({resumeSessionId:f.row.sessionId,agentOptions:{provider:'controlled',model:'model-a'}});t.after(()=>external.dispose());release.resolve();
  const result=await pending;assert.equal(result.error,undefined);assert.equal(result.value,external.agent);assert.equal(f.ctx.agents.get(f.row.sessionId),external.agent);assert.equal(f.requests.length,0);
  await f.adapter.close();assert.equal(f.ctx.agents.get(f.row.sessionId),external.agent,'resuming an already published external identity must not acquire its AgentHandle ownership');
});

test('adapter close drains a pending cold inspection and prevents new native resume admission',async t=>{
  const f=await coldContact(t),inspect=f.adapter.inspectSession.bind(f.adapter),entered=deferred(),release=deferred();t.after(()=>release.resolve());
  f.adapter.inspectSession=async(...args)=>{const history=await inspect(...args);entered.resolve();await release.promise;return history;};
  const pending=f.adapter.resumeOwned(f.row).then(value=>({value}),error=>({error}));await entered.promise;let closed=false;
  const closing=f.adapter.close().then(()=>{closed=true;});await new Promise(resolve=>setImmediate(resolve));const closedEarly=closed;release.resolve();const result=await pending;await closing;
  assert.equal(closedEarly,false);assert.equal(result.error?.code,'disposed');assert.equal(f.ctx.agents.get(f.row.sessionId),undefined);assert.equal(f.requests.length,0);
});

for(const action of ['archive','restore'])test(`${action} releases its ordinary admission fence after a lost native outcome without replaying that mutation`,async t=>{
  const f=await businessFixture(t),handle=await f.ctx.agents.create({sessionId:`ordinary-${action}-unknown`,meta:{cwd:f.dir},agentOptions:{provider:'controlled',model:'model-a'}});f.beforeClose.push(()=>handle.dispose());await f.ctx.sessions.flush(handle.agent.session);
  if(action==='restore')await f.sessions.archive(f.human,command('session.archive',{sessionId:handle.agent.id}));
  const registry=f.ctx.workspaceRegistry,method=action==='archive'?'archiveSession':'unarchiveSession',native=registry[method].bind(registry);let mutations=0,calls=0;
  registry[method]=async(...args)=>{mutations++;await native(...args);throw Object.assign(Error('Controlled lost native outcome'),{code:'audit_native_archive_unknown'});};
  t.after(f.ctx.tools.register({name:`v112_${action}_after_failure`,description:'Count a harmless native call',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'boolean'},render:()=>[{type:'text',text:'done'}]},execute:async()=>{calls++;return true;}}));
  const op=command(`session.${action}`,{sessionId:handle.agent.id});await assert.rejects(f.sessions[action](f.human,op),{code:'audit_native_archive_unknown'});assert.equal(f.store.read().sessions[handle.agent.id].state,'UNKNOWN');const before=f.store.read();
  assert.equal((await tool(f,handle.agent,`v112_${action}_after_failure`)).isError,false);assert.equal(calls,1);await assert.rejects(f.sessions[action](f.human,op),{code:'session_outcome_unknown'});assert.equal(mutations,1);assert.deepEqual(f.store.read(),before);
});
